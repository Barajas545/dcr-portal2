// saved-overlay.js — the overlay the desktop saved for a sheet, put up when
// he arrives on it, and taken down whenever he leaves. LOOKING ONLY: nothing
// here writes a record, marks the project or moves its change count.
//
// The desktop (_restore_overlay_for_page) puts a sheet's saved overlay up on
// every arrival: another sheet, a revision of it, or a picture of it, in its
// own tint, fade and look (js/core/overlay-look.js). This is that, for the
// web, as a small state machine its host (js/main.js) drives from the page
// turns and the version steps:
//
//   turn(page, how)   goToPage's first word. The LAST sheet's overlay comes
//                     down here, always, before anything can be restored --
//                     never behind an early return (the desktop's revision
//                     branch returns without it, and leaves the last sheet's
//                     comparison up over this one: reported for 3.08). A
//                     'keep' of the sheet he is on (a save's re-read), and
//                     its own card tapped again, are the same visit and
//                     keep it (the card asks again for one whose read
//                     failed, as offline).
//   settle(...)       the drawing he landed on is up, or a version step
//                     changed it: put this sheet's overlay up if its record
//                     names something it can show -- on the sheet's OWN
//                     drawing only. On another version it is not drawn (the
//                     desktop's paint gate, 'never over another version');
//                     landing there, he is told once that the overlay is on
//                     the sheet's own drawing and how to get to it. (The
//                     desktop lands on the own drawing instead while an
//                     overlay is up; the web stays on the newest so the
//                     takeoff stays editable -- the user's decision.)
//   hide()            Hide / Escape: down for this visit; the next arrival
//                     brings it back. Writes nothing.
//   stepAside()       Compare (the version bar's red/blue) goes up: one
//                     overlay on screen at a time. Down for the rest of the
//                     visit -- it does not come back when Compare ends.
//   flash()           blink at the desktop's default speed (Medium, 0.7 s).
//   takeDown()        a job opened or reset: down, its bitmap closed.
//
// The mask is built once per arrival (source, decode size, look) and held
// here, outside the page store's LRU, so a page turn elsewhere can never
// evict it; it is closed whenever the overlay comes down. The tint and the
// fade are applied when it is drawn (frame()): a tint or a fade is never a
// rebuild.

import {
  overlaySourceOf, overlayRect, overlayEntryLabel, pictureName, fadePercent,
  tintCss, KEPT_NOTE_UNREADABLE,
} from './overlay-look.js';

/** The desktop's Flash speed by default: Medium (0.7 s). */
export const FLASH_MS = 700;

/** Said once, landing on a sheet whose newest drawing is up and whose saved
 *  overlay is on its own drawing (the user's decision 2). */
export const VERSION_NOTE = 'This sheet has a saved overlay on its own drawing. '
  + 'Step back to its own drawing (‹ on the version bar, with the toolbars at the top) to see it.';

/** Said when Hide (or Escape) takes it down. */
export const HIDDEN_NOTE = 'Overlay hidden — it comes back the next time you turn to this sheet.';

/** ...and when Compare does. */
export const COMPARE_NOTE = 'The saved overlay is off while you compare, and stays off '
  + 'until you next turn to this sheet.';

/** How the sentence that a sheet's saved overlay could not be shown begins. */
const FAILED_WORDS = "Could not show this sheet's saved overlay — ";

/** Whether a line on the status bar or the finger's toast is one of these
 *  sentences about a sheet's saved overlay -- "this sheet", the one it was
 *  said on -- which a turn to another sheet takes down. Compare's line ends
 *  with COMPARE_NOTE ('Comparing: ... The saved overlay is off while you
 *  compare'), and on the next sheet both halves are false: it goes too. */
export function overlayWords(text) {
  const t = String(text || '');
  return t === VERSION_NOTE || t === HIDDEN_NOTE || t === KEPT_NOTE_UNREADABLE
    || t === COMPARE_NOTE || t.endsWith(` ${COMPARE_NOTE}`)
    || t.startsWith(FAILED_WORDS);
}

export class SavedOverlay {
  /**
   * `host`:
   *   record(page)        the sheet's saved record (read, never written)
   *   context(page)       {pageCount, revisions, pictures} for overlaySourceOf
   *   metadata()          for the sheet labels
   *   sheetUp(page)       he is on that sheet with its drawing up, in this job
   *   onVersion()         another version of the sheet is on screen
   *   comparing()         the version bar's Compare is up
   *   pixels(src)         Promise<{img, owned, ...}>: the source, to be read
   *   surface(px, look, free)  Promise<{image, width, height, cutoff,
   *                       close()}>; calls free() once the source's pixels
   *                       are read, so an owned decode goes before the mask
   *                       is made
   *   revisionName(src)   what the strip calls a revision source
   *   strip(state|null)   show what is up, or nothing
   *   draw()              ask for a frame
   *   say(text, how, still)  a sentence; `how` is the landing's ('open' /
   *                       'turn'); `still()` whether it is still true -- the
   *                       same visit of the same sheet, and (VERSION_NOTE)
   *                       the newest drawing still up -- for one said later
   *   every(fn, ms) / stop(id)   timers (setInterval / clearInterval)
   *   release(img)        close a decode this owns
   *   retire()            take this module's sentences off the line (a turn)
   */
  constructor(host) {
    this.host = {
      every: (fn, ms) => setInterval(fn, ms),
      stop: id => clearInterval(id),
      release: img => img?.close?.(),
      revisionName: src => String(src.revId),
      ...host,
    };
    this.visit = null;        // {page, hidden: '' | 'hide' | 'compare', said,
                              //  failed: false | 'read' | 'unreadable' (a picture)}
    this.up = null;           // {page, src, surface, size, label, flashOn}
    this.building = 0;        // the ticket of a build in flight, or 0
    this.ticket = 0;
    this.flashTimer = 0;
    this.unreadSaid = new Set();
  }

  /** A goToPage is starting: a new visit, and the last one's overlay down --
   *  and what was said about that sheet's overlay comes off the line with it
   *  (host.retire: it says "this sheet", and was about the one he left).
   *  The same visit goes on for a 'keep' of the sheet he is on (a save's
   *  re-read), and for a turn onto the sheet he is already on with its
   *  drawing up -- its own card tapped again: nothing turned, so a Hide
   *  stands ("until you next turn to this sheet") -- but one whose read
   *  failed is asked again. A job opening is always a new visit, whatever
   *  its sheet's number. */
  turn(page, how) {
    const same = this.visit && this.visit.page === page
      && (how === 'keep' || (how === 'turn' && this.host.sheetUp(page)));
    if (same) {
      // ...but its card tapped again asks once more for an overlay whose
      // READ failed (the network's, it may well have been): the settle after
      // this tries it again, and the sentence that said it failed comes off
      // the line. A picture that would not decode is not asked again -- its
      // bytes are in the file, and they will not decode the next time.
      if (how === 'turn' && this.visit.failed === 'read' && !this.building) {
        this.visit.failed = false;
        this.host.retire?.();
      }
      return false;
    }
    this.takeDown({ draw: false });
    this.visit = { page, hidden: '', said: false, failed: false };
    this.host.retire?.();
    return true;
  }

  /** Whether `text`, said (or queued) on `visit`, is still true: the same
   *  visit of a sheet still up -- not another job's sheet of that number,
   *  not after a turn -- and the arrival's VERSION_NOTE only while the
   *  newest drawing is up (on the sheet's own drawing the overlay is there
   *  to see). */
  stillTrue(text, visit) {
    if (!visit || this.visit !== visit || !this.host.sheetUp(visit.page)) return false;
    if (text === VERSION_NOTE) return !visit.hidden && this.host.onVersion();
    // ...and that it could not be shown, only until it is asked again
    if (text === KEPT_NOTE_UNREADABLE || String(text).startsWith(FAILED_WORDS)) return !!visit.failed;
    return true;
  }

  _say(text, how) {
    const visit = this.visit;
    this.host.say(text, how, () => this.stillTrue(text, visit));
  }

  /** Whether it is flashing: the renderer keeps its tint canvas for the
   *  blink rather than making one twice a second. */
  flashing() { return !!this.flashTimer && !!this.up; }

  /** Down: no build may still land, the flash stops, the mask is closed. */
  takeDown({ draw = true } = {}) {
    this.ticket += 1;
    this.building = 0;
    this._stopFlash();
    const was = this.up;
    this.up = null;
    if (was) was.surface.close?.();
    this.host.strip(null);
    if (draw && was) this.host.draw();
    return !!was;
  }

  /** The drawing he is on is up, or changed: put up what this sheet saved. */
  settle({ arrival = false, how = '' } = {}) {
    const v = this.visit;
    if (!v) return;
    if (this.up) {
      // Off the screen (another version, Compare): a flash would go on
      // repainting the whole sheet twice a second for nothing.
      if (!this._box()) this._stopFlash();
      this.host.strip(this.stripState());
      this.host.draw();
      return;
    }
    // A source that would not decode is not asked again this visit: every
    // version step and mode change settles, and each would decode it again.
    if (v.hidden || v.failed || this.building || !this.host.sheetUp(v.page)) return;
    const src = overlaySourceOf(this.host.record(v.page), this.host.context(v.page));
    if (!src) return;
    if (this.host.onVersion()) {
      if (arrival && !v.said) {
        v.said = true;
        this._say(VERSION_NOTE, how);
      }
      return;
    }
    if (this.host.comparing()) return;
    this._build(v.page, src, how);
  }

  async _build(page, src, how) {
    const ticket = ++this.ticket;
    this.building = ticket;
    const live = () => ticket === this.ticket && !!this.visit
      && this.visit.page === page && !this.visit.hidden;
    let px = null;
    let surface = null;
    let freed = false;
    // An owned decode goes as soon as its pixels are read (the surface calls
    // this before it makes the mask), and on every way out.
    const free = () => {
      if (freed || !px || !px.owned) return;
      freed = true;
      this.host.release(px.img);
    };
    try {
      px = await this.host.pixels(src);
      if (!live()) return;
      surface = await this.host.surface(px, src.look, free);
    } catch (err) {
      if (live()) {
        this.visit.failed = src.kind === 'picture' ? 'unreadable' : 'read';
        this._failed(src, err, how);
      }
      return;
    } finally {
      free();
      if (this.building === ticket) this.building = 0;
    }
    if (!live()) { surface.close?.(); return; }
    this.up = {
      page, src, surface,
      size: [surface.width, surface.height],
      label: this._label(page, src),
      flashOn: true,
    };
    this.host.strip(this.stripState());
    this.host.draw();
  }

  _failed(src, err, how) {
    if (src.kind === 'picture') {
      // Once a picture (by its id and its bytes), as the desktop says it.
      const key = `${src.imageId}:${(src.entity.img_b64 || '').length}`;
      if (this.unreadSaid.has(key)) return;
      this.unreadSaid.add(key);
      this._say(KEPT_NOTE_UNREADABLE, how);
      return;
    }
    this._say(`${FAILED_WORDS}${(err && err.message) || err}`, how);
  }

  _label(page, src) {
    if (src.kind === 'sheet') return `Overlay: ${overlayEntryLabel(this.host.metadata(), src.page)}`;
    if (src.kind === 'revision') return `Overlay: ${this.host.revisionName(src)}`;
    return `Overlay: ${pictureName(this.host.context(page).pictures, src.imageId)}`;
  }

  /** Where it is drawn right now, page px, or null: not while another
   *  version is up or Compare is, not off its own sheet, and a picture at
   *  its own box as the entity says it now (found by id each time). */
  _box() {
    const u = this.up;
    if (!u || !this.host.sheetUp(u.page) || this.host.onVersion() || this.host.comparing()) return null;
    const pics = u.src.kind === 'picture' ? this.host.context(u.page).pictures : null;
    return overlayRect(u.src, u.size, pics);
  }

  /** What the renderer draws this frame, or null. */
  frame() {
    const u = this.up;
    if (!u || !u.flashOn) return null;
    const box = this._box();
    if (!box) return null;
    return {
      image: u.surface.image,
      box,
      alpha: u.src.alpha,
      // Original colours carry their own; the tint would dye them.
      tint: u.src.look.mode === 'original' ? null : tintCss(u.src.color),
    };
  }

  /** The strip's line, or null when nothing is on screen. */
  stripState() {
    const u = this.up;
    if (!u || !this._box()) return null;
    return {
      label: u.label,
      percent: fadePercent(u.src.alphaSaved),
      color: u.src.look.mode === 'original' ? null : tintCss(u.src.color),
      flashing: !!this.flashTimer,
      kind: u.src.kind,
      cutoff: u.surface.cutoff,
    };
  }

  /** Is it on screen (Escape takes it down)? */
  shown() { return !!this.stripState(); }

  /** Hide: down for this visit. */
  hide(why = 'hide') {
    if (!this.visit) return false;
    this.visit.hidden = why;
    return this.takeDown();
  }

  /** Compare is going up: this one gives way for the rest of the visit.
   *  True when it was up, or this sheet had one to put up. */
  stepAside() {
    const v = this.visit;
    if (!v) return false;
    const had = !!this.up || !!this.building
      || (!v.hidden && !!overlaySourceOf(this.host.record(v.page), this.host.context(v.page)));
    v.hidden = 'compare';
    this.takeDown();
    return had;
  }

  /** Flash on or off. */
  flash() {
    const u = this.up;
    if (!u) return false;
    if (this.flashTimer) {
      this._stopFlash();
    } else {
      this.flashTimer = this.host.every(() => {
        // Nothing to blink while it is off the screen: no repaint for it.
        if (!this.up || !this._box()) return;
        this.up.flashOn = !this.up.flashOn;
        this.host.draw();
      }, FLASH_MS);
    }
    this.host.strip(this.stripState());
    this.host.draw();
    return !!this.flashTimer;
  }

  _stopFlash() {
    if (this.flashTimer) this.host.stop(this.flashTimer);
    this.flashTimer = 0;
    if (this.up) this.up.flashOn = true;
  }
}

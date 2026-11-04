// version-bar.js — the strip that says which version of this sheet is on
// screen, and lets you walk the others.
//
// A job with no plan revisions must look EXACTLY as it did before this feature
// existed: the bar is hidden, nothing shifts by a pixel, and the pips draw
// nothing. That is the common case — most projects have one drawing set.
//
// Visibility is a PROJECT-level decision, not a per-sheet one. If any revision
// is visible the bar stays up for every sheet, saying "1 version" on the sheets
// that were never reissued. Showing and hiding it per sheet would move the
// whole page under the cursor as you paged through a set.

import {
  sheetVersions, newestVersionOf, visibleRevisions, revPageCount,
} from '../core/revisions.js';

// Pip geometry, from the desktop's _VersionPips.
const PIP_R = 4;            // radius of one pip
const PIP_GAP = 5;          // space between pips at full pitch
const PIP_MIN_STEP = 7;     // the floor — see _step() below
const PIP_PAD = 3;

export class VersionBar {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root       the bar element
   * @param {HTMLCanvasElement} o.pips the pip strip
   * @param {() => object} o.state     { page, revs, viewingRevId, workingRevId }
   * @param {(revId:string) => void} o.onPick
   */
  constructor({ root, pips, state, onPick }) {
    this.root = root;
    this.pips = pips;
    this.state = state;
    this.onPick = onPick;
    this._hit = [];          // [{x, revId}] in CSS pixels, for the click test

    this.pips.addEventListener('click', ev => {
      const rect = this.pips.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      let best = null;
      let bestD = Infinity;
      for (const h of this._hit) {
        const d = Math.abs(h.x - x);
        if (d < bestD) { bestD = d; best = h; }
      }
      // A pip is small and a finger is not, so the nearest one within half a
      // step counts as a hit rather than requiring the centre.
      if (best && bestD <= Math.max(PIP_MIN_STEP, PIP_R * 2)) this.onPick?.(best.revId);
    });
  }

  /** Should this project show the bar at all? */
  static shouldShow(revs) {
    return visibleRevisions(revs).length > 0;
  }

  refresh() {
    const s = this.state();
    const revs = s.revs || [];
    if (!VersionBar.shouldShow(revs) || !(s.page >= 0)) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;

    // With the sheet's ORIGIN: a sheet a revision added is that revision's
    // page, so the page is not "a newer version" of it and its own drawing
    // ranks as the revision it came from.
    const vers = sheetVersions(s.page, revs, s.origins);
    const viewing = String(s.viewingRevId || '');
    const cur = vers.find(v => v.revId === viewing) || vers[0];
    const newest = newestVersionOf(s.page, revs, s.order || 'date', s.origins);

    this.root.querySelector('#vbSheet').textContent =
      `Sheet ${s.sheetLabel || s.page + 1}`;

    const showing = this.root.querySelector('#vbShowing');
    const n = vers.length;
    // Is the drawing on screen the newest there is? Derived from the RANK,
    // never from position in the list: the revisions in a real file are not in
    // date order — measured, one dated 06-19 sits ninth of eleven — so
    // counting columns would call the newest drawing old.
    const onNewest = viewing === String(newest || '');
    const which = viewing ? vers.findIndex(v => v.revId === viewing) + 1 : 1;

    if (n <= 1) {
      showing.textContent = '· only one version';
      showing.classList.remove('rev');
    } else if (onNewest) {
      showing.textContent = `· newest of ${n} drawings`;
      showing.classList.remove('rev');
    } else {
      // The sheet's own drawing is just the first of the run now, and when
      // something newer exists it is as superseded as any other old issue.
      const what = viewing
        ? `${cur.label}${cur.date ? ` (${cur.date})` : ''}`
        : 'the original drawing';
      showing.textContent = `· OLD — showing ${what}, ${which} of ${n}`;
      showing.classList.add('rev');
    }

    // Nothing to go back to until you have gone somewhere.
    const back = this.root.querySelector('#vbNewestBtn');
    if (back) back.disabled = onNewest || n <= 1;

    // The ONE control that moves a total: count this sheet from the drawing
    // on screen. Live only when the drawing on screen is not the one counted
    // and the project can be edited; the click shows the before and the
    // after, and changes nothing until he says yes.
    const count = this.root.querySelector('#vbCountBtn');
    if (count) {
      const working = String(s.workingRevId || '');
      const already = viewing === working;
      count.hidden = n <= 1 && already;
      count.disabled = already || !s.canCount;
      count.classList.toggle('on', !already);
      count.title = already
        ? `This sheet counts from ${viewing ? cur.label : 'its own drawing'} — the drawing on screen`
        : (s.canCount
          ? `This sheet counts from ${working ? (vers.find(v => v.revId === working) || {}).label || 'another drawing' : 'its own drawing'}. `
            + 'Count the drawing on screen instead — you are shown the change before it is made'
          : 'Press Edit Mode to change which drawing this sheet counts from');
    }

    this._drawPips(vers, viewing, s.workingRevId || '', newest);
  }

  /**
   * One pip per version of this sheet.
   *
   *   filled            this version exists
   *   ringed green      it is the one on screen
   *   gold inner dot    it is the version the totals are counted from
   *
   * The pitch is floored at PIP_MIN_STEP. A 173-sheet job with 11 revisions
   * would otherwise divide the strip down to nothing and leave no ring and no
   * dot — on exactly the job the bar exists for.
   */
  _drawPips(vers, viewing, working, newest) {
    const c = this.pips;
    const n = vers.length;
    this._hit = [];
    const dpr = Math.min(3, window.devicePixelRatio || 1);

    if (n <= 1) {
      // Keep the element, drop the ink: a single-version sheet says so in
      // words and a lone pip would only look like something to click.
      c.width = 1; c.height = 1;
      c.style.width = '0px';
      return;
    }

    const step = Math.max(PIP_MIN_STEP, PIP_R * 2 + PIP_GAP);
    const w = PIP_PAD * 2 + step * (n - 1) + PIP_R * 2;
    const h = PIP_R * 2 + PIP_PAD * 2 + 4;
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);

    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const style = getComputedStyle(document.documentElement);
    const on = style.getPropertyValue('--rev-on').trim() || '#8fd14f';
    const slot = style.getPropertyValue('--rev-slot').trim() || '#c9a648';
    const dim = style.getPropertyValue('--text-faint').trim() || '#606060';
    const lit = style.getPropertyValue('--text-2').trim() || '#d0d0d0';

    const cy = h / 2;
    for (let i = 0; i < n; i++) {
      const cx = PIP_PAD + PIP_R + step * i;
      const v = vers[i];
      this._hit.push({ x: cx, revId: v.revId });

      ctx.beginPath();
      ctx.arc(cx, cy, PIP_R, 0, Math.PI * 2);
      // The newest version reads brighter, so "is there something newer" is
      // answerable without reading the words.
      ctx.fillStyle = (v.revId === (newest || '') && v.revId) ? lit : dim;
      ctx.fill();

      if (v.revId === viewing) {
        ctx.beginPath();
        ctx.arc(cx, cy, PIP_R + 2.5, 0, Math.PI * 2);
        ctx.strokeStyle = on;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (v.revId === String(working || '')) {
        ctx.beginPath();
        ctx.arc(cx, cy, PIP_R - 2, 0, Math.PI * 2);
        ctx.fillStyle = slot;
        ctx.fill();
      }
    }

    const names = vers.map((v, i) =>
      `${i + 1}. ${v.label}${v.date ? ` (${v.date})` : ''}`
      + (v.revId === viewing ? '  ← on screen' : '')).join('\n');
    c.title = `Every version of this sheet:\n${names}`;
  }
}

/**
 * Which sheets have a version newer than their own drawing.
 *
 * Used for the pips on the sheets list. One pass over the visible revisions
 * rather than one `newestVersionOf` call per sheet: on the largest real job
 * that is 11 map lookups instead of 173 × 11.
 */
export function sheetsWithRevisions(pageCount, revs, origins = null) {
  const out = new Map();          // page -> how many versions beyond its own
  for (const rev of visibleRevisions(revs)) {
    const n = revPageCount(rev);
    for (const [k, rp] of Object.entries(rev.match || {})) {
      const i = parseInt(k, 10);
      if (!Number.isFinite(i) || i < 0 || i >= pageCount) continue;
      if (!(rp >= 0 && rp < n)) continue;
      // The page a sheet was CUT FROM is that sheet, not a version of it.
      const o = (origins || {})[String(i)];
      if (Array.isArray(o) && o.length >= 2 && String(o[0]) === String(rev.id)
          && Number(o[1]) === rp) continue;
      out.set(i, (out.get(i) || 0) + 1);
    }
  }
  return out;
}

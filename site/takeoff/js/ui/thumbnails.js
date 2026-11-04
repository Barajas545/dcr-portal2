// thumbnails.js — the sheets list.
//
// A drawing set runs to hundreds of sheets, and decoding every one of them at
// full size to make a thumbnail would be the single most expensive thing this
// app does. So the rows are built immediately with empty tiles and the images
// arrive as an IntersectionObserver notices each row scroll into view —
// decoded once, at thumbnail size, straight out of the PNG.

export class Thumbnails {
  constructor({ listEl, panelEl, project, pages, onPick, revisionCounts,
                onSlideVersion, versionState, tileStates }) {
    this.listEl = listEl;
    this.panelEl = panelEl;
    this.project = project;
    this.pages = pages;
    this.onPick = onPick;
    // Sliding a card sideways walks that sheet's versions: (index, step).
    this.onSlideVersion = onSlideVersion || null;
    // () => { page, old, which, count } — which sheet is showing something
    // other than its newest drawing, and where in the run it sits. Read, not
    // stored, so the list can never disagree with the drawing on screen.
    this.versionState = versionState || (() => ({ page: -1, old: false }));
    // () => Map<pageIndex, how many revision sets reissued that sheet>. A job
    // with no revisions hands back an empty map and no card changes at all,
    // which is the point: most projects have one drawing set and must look
    // exactly as they did.
    this.revisionCounts = revisionCounts || (() => new Map());
    // () => {page: {kind, text, short, tip}} — what each tile says about the
    // sheet's drawings, worded by the desktop's own rule
    // (CountingModel.sheetTileStates): REV n when a revision superseded the
    // sheet, ADDED when a revision brought it, ⚠ when the takeoff counts from
    // a drawing other than the one the list shows. A page left out is an
    // original never revised, and its card looks exactly as it always did.
    this.tileStates = tileStates || (() => ({}));
    this.current = 0;
    this._rows = [];

    this._io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        this._io.unobserve(e.target);
        this._fill(e.target);
      }
    }, { root: listEl, rootMargin: '300px 0px' });
  }

  refresh(current = this.current) {
    this._io.disconnect();
    this.listEl.textContent = '';
    this._rows = [];
    const n = this.pages.pageCount;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const row = this._row(i);
      this._rows.push(row);
      frag.appendChild(row);
    }
    this.listEl.appendChild(frag);
    for (const r of this._rows) this._io.observe(r);
    this.setCurrent(current);
  }

  _row(i) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.index = String(i);

    // Everything that should travel with the finger lives in one wrapper, so
    // the slide is a single transform and not a layout.
    const slide = document.createElement('div');
    slide.className = 'thumb-slide';

    const img = document.createElement('canvas');
    img.className = 'thumb-img';
    slide.appendChild(img);

    const cap = document.createElement('div');
    cap.className = 'thumb-cap';
    const no = document.createElement('span');
    no.className = 'thumb-no';
    cap.appendChild(no);
    const vs = document.createElement('span');
    vs.className = 'thumb-vs';
    cap.appendChild(vs);
    const ver = document.createElement('span');
    ver.className = 'thumb-ver';
    cap.appendChild(ver);
    const badge = document.createElement('span');
    badge.className = 'thumb-badge';
    cap.appendChild(badge);
    const name = document.createElement('span');
    name.className = 'thumb-name';
    cap.appendChild(name);
    const rev = document.createElement('span');
    rev.className = 'thumb-rev';
    cap.appendChild(rev);
    slide.appendChild(cap);
    el.appendChild(slide);

    const swipe = document.createElement('div');
    swipe.className = 'thumb-swipe';
    swipe.innerHTML = '<span>\u2039</span><span>\u203a</span>';
    el.appendChild(swipe);

    this._label(el, i);
    this._armSlide(el, i);
    return el;
  }

  _label(el, i) {
    // Through the project's own accessors, both of them.
    //
    // `pageLabel` applies the user's override; reading `page_labels` direct
    // showed the DETECTED number here and the corrected one everywhere else.
    // `pageName` keys `page_names` by the STRING index, which is the shape
    // that dict actually has — indexing it with a number returned undefined
    // on every sheet of every project, so the name has never been on screen.
    const label = this.project.pageLabel(i);
    const name = this.project.pageName(i);
    const no = el.querySelector('.thumb-no');
    no.textContent = label;
    no.title = name ? `${label} — ${name}` : label;
    el.querySelector('.thumb-name').textContent = name;
    el.querySelector('.thumb-name').title = name;
    const items = (this.project.measurements[i] || []).filter(m => !m.group_child).length;
    const badge = el.querySelector('.thumb-badge');
    badge.textContent = items ? String(items) : '';
    badge.title = items ? `${items} takeoff item${items === 1 ? '' : 's'} on this sheet` : '';

    // How many times this sheet was re-issued. One dot per revision that
    // carries it, so a glance down the list shows which drawings changed —
    // and a job with no revisions gets an empty span and no layout shift.
    const rev = el.querySelector('.thumb-rev');
    const n = this.revisionCounts().get(i) || 0;
    rev.textContent = n ? '•'.repeat(Math.min(n, 4)) + (n > 4 ? '+' : '') : '';
    rev.title = n
      ? `${n} revision${n === 1 ? '' : 's'} re-issued this sheet — `
        + 'slide the card sideways to walk through them'
      : '';
    el.classList.toggle('hasrev', n > 0);
    this._tileState(el, i);
    this._versionMark(el, i);
  }

  /**
   * The chip: where the drawing the list stands for came from. In WORDS on a
   * chip of its own and in colour on the card's right edge — never in colour
   * alone — with the whole story in the tooltip.
   */
  _tileState(el, i) {
    const st = (this.tileStates() || {})[i] || null;
    const chip = el.querySelector('.thumb-vs');
    for (const k of ['rev', 'added', 'warn']) el.classList.toggle(`vs-${k}`, !!st && st.kind === k);
    if (!chip) return;
    chip.textContent = st ? st.text : '';
    chip.title = st ? st.tip : '';
    el.dataset.vs = st ? st.kind : '';
  }

  /** Repaint every chip without rebuilding a row. */
  syncTiles() {
    for (const r of this._rows) this._tileState(r, Number(r.dataset.index));
  }

  /**
   * The red frame, and which drawing of the run is on screen.
   *
   * Only the sheet being LOOKED at can be on an older version — there is one
   * drawing on screen — so at most one card carries the mark, and it is read
   * from the app rather than remembered here, where it could drift.
   */
  _versionMark(el, i) {
    const st = this.versionState() || {};
    const mine = st.page === i && !!st.old;
    el.classList.toggle('oldver', mine);
    const ver = el.querySelector('.thumb-ver');
    if (!ver) return;
    if (st.page === i && st.count > 1) {
      ver.textContent = `v${st.which}/${st.count}`;
      ver.title = mine
        ? 'This is not the newest drawing of this sheet'
        : 'The newest drawing of this sheet';
    } else {
      ver.textContent = '';
      ver.title = '';
    }
  }

  /** Repaint the version marks without rebuilding a row. */
  syncVersions() {
    for (const r of this._rows) this._versionMark(r, Number(r.dataset.index));
  }

  /**
   * Slide a card sideways to change which drawing of that sheet is shown.
   *
   * A tap still opens the sheet. The two are told apart on RELEASE by how far
   * the pointer travelled — the same 4px rule the callout bubbles use, because
   * a card is both a button and a thing you can push.
   */
  _armSlide(el, i) {
    const slide = el.querySelector('.thumb-slide');
    const SLOP = 4;          // under this, it was a tap
    const TRIP = 34;         // past this, it was a slide
    let id = null;
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let decided = '';        // '' | 'slide' | 'scroll'

    const settle = () => {
      el.classList.add('settling');
      slide.style.transform = '';
      setTimeout(() => el.classList.remove('settling'), 180);
    };

    el.addEventListener('pointerdown', ev => {
      if (ev.button != null && ev.button !== 0) return;
      id = ev.pointerId; x0 = ev.clientX; y0 = ev.clientY; dx = 0; decided = '';
    });

    el.addEventListener('pointermove', ev => {
      if (ev.pointerId !== id) return;
      dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!decided) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Whichever axis won first owns the gesture for the rest of it.
        // Deciding every move instead would let a drifting finger flip
        // between scrolling the list and sliding the card.
        decided = Math.abs(dx) > Math.abs(dy) ? 'slide' : 'scroll';
        if (decided === 'slide') {
          // Only take the pointer once we are sure, or the list cannot be
          // scrolled by starting on a card — which is most of the list.
          try { el.setPointerCapture(id); } catch { /* not ours to keep */ }
        }
      }
      if (decided !== 'slide') return;
      ev.preventDefault();
      // Rubber-banding past the trip point says "that is as far as it goes"
      // without stopping dead.
      const pull = Math.abs(dx) <= TRIP ? dx : Math.sign(dx) * (TRIP + (Math.abs(dx) - TRIP) * 0.25);
      slide.style.transform = `translateX(${pull.toFixed(1)}px)`;
    });

    const done = ev => {
      if (ev.pointerId !== id) return;
      const travelled = decided === 'slide' ? dx : 0;
      const wasSlide = decided === 'slide';
      const decidedAxis = decided;
      try { el.releasePointerCapture(id); } catch { /* already gone */ }
      id = null; decided = '';
      settle();
      // Anything that was not a scroll, and did not travel far enough to be a
      // slide, is a tap.
      //
      // The first version of this asked for a release within 4px of the press,
      // which is a rule for telling a tap from a DRAG, not for deciding
      // whether a tap counts — and it left a dead band from 4px to 34px where
      // a touch was judged an unfinished slide and did nothing at all: no
      // sheet, no version, no feedback. A finger does not land still, so that
      // band is where most real taps live.
      if (decidedAxis !== 'slide' || Math.abs(travelled) < TRIP) {
        if (decidedAxis !== 'scroll') this.onPick?.(i);
        return;
      }
      // Right is forward in time, left is back — the direction the drawing
      // moves, not the direction the stack moves.
      this.onSlideVersion?.(i, travelled > 0 ? 1 : -1);
    };

    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', ev => {
      if (ev.pointerId !== id) return;
      try { el.releasePointerCapture(id); } catch { /* already gone */ }
      id = null; decided = '';
      settle();
    });
  }

  async _fill(el) {
    const i = Number(el.dataset.index);
    const canvas = el.querySelector('.thumb-img');
    if (!canvas || canvas.dataset.done) return;
    try {
      const bmp = await this.pages.getThumbnail(i, 176);
      if (!bmp) return;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.style.aspectRatio = `${bmp.width} / ${bmp.height}`;
      canvas.getContext('2d').drawImage(bmp, 0, 0);
      canvas.dataset.done = '1';
    } catch {
      // An undecodable sheet still gets a row and a number — the thumbnail is
      // a convenience, and losing it must not lose the page.
      canvas.style.minHeight = '40px';
    }
  }

  setCurrent(index) {
    this.current = index;
    for (const r of this._rows) {
      const on = Number(r.dataset.index) === index;
      r.classList.toggle('on', on);
      if (on) r.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Re-read the labels and item counts without rebuilding the rows. */
  syncLabels() {
    for (const r of this._rows) this._label(r, Number(r.dataset.index));
  }
}

// items-panel.js — the PROJECT ITEMS tree.
//
// THE TREE IS DERIVED, NEVER STORED. Every rebuild walks the flat measurement
// store and nests items by three string fields on each item: floor_level,
// category, sub_category. Ordering inside every level is by sort_order, and a
// group's position is the MINIMUM sort_order of the items under it.
//
// Introducing a persisted tree here would be a bug, not a feature: an older
// .takeoff file has no such structure, and two sources of truth for where an
// item sits is exactly how items go missing from an estimate.

import {
  valueString, notesWithPurpose, displayName, itemUnit, expandAssembly,
} from '../core/measure.js';
import { GROUP_HUES, mix, itemColor, hex } from '../render/theme.js';
import { unitTotals } from './report-html.js';
import { reportQty } from '../core/measure.js';
import { STANDALONE_PAGE } from '../core/takeoff-file.js';
import {
  CountingModel, sheetRows, sheetTitle, sheetTip, sheetNotes, sheetValueStr, sheetPageWords,
  countsHere, notCountedHereWhy, soloCount,
} from '../core/counting.js';
import { headerAct, headerTip, rowsUnder, HDR_FIELD, HDR_WHAT, SOLO } from '../core/classify.js';
import {
  classNameProblem, classificationPlan, existingSpelling, classLists, renameWhat, renameNotes,
  mergeQuestion, renameSaid, followRename, renameClassification, isClassRow, unfiledItems,
  sheetsOfGroups, assignWhat, assignOptions, assignSaid, assignClassification, applyClassTool,
  pyTitle, pyCapitalize, classStrip, rowsNow,
} from '../core/classify.js';
import { holdGesture } from './hold.js';
import { pyFixed } from '../core/pyformat.js';
import { itemCost } from '../core/measure.js';

/** Item types the panel never lists — rulers, markup and Group containers. */
const EXCLUDED = new Set(['distance', 'textnote', 'page_ref', 'pitch', 'ref_distance', 'group']);

export const FLOOR_LEVEL_PRESETS = [
  '', 'Level 1', 'Level 2', 'Level 3', 'Level 4',
  'Roof', 'Basement', 'Foundation', 'Mezzanine', 'Penthouse',
];
export const CATEGORY_PRESETS = [
  '', 'Framing', 'Concrete', 'Masonry', 'Structural Steel',
  'Wood Framing', 'MEP', 'Electrical', 'Plumbing', 'HVAC',
  'Roofing', 'Drywall', 'Flooring', 'Doors & Windows',
  'Insulation', 'Site Work', 'Miscellaneous',
];

/** Said once a session, the first time the list is on screen with something
 *  in it in the touch layout: an iPad never shows a tooltip. */
export const HOLD_HINT = 'Hold a heading or a row for its menu';

/** The section of the items on no sheet, while the list shows one sheet
 *  (desktop _SOLO): its fold key, its heading, its hue. */
export const SOLO_KEY = `fl\x00${SOLO}`;
export const SOLO_LABEL = 'Not on a sheet';
export const SOLO_HUE = '#8c8c8c';

/** The per-browser setting the chip is kept in -- the desktop's own key. */
export const SHEET_SETTING = 'items_panel_sheet_only';

/** How long a page turn or a drawing flip waits before the list follows
 *  (desktop _sheet_timer): Newest lands on a sheet and then on its newest
 *  drawing, two changes, and the list rebuilds once. */
export const SHEET_FOLLOW_MS = 80;

/** The drawing a list on one sheet was built for: page, revision, its page. */
export function sheetKeyOf(view) {
  return view ? `${view.page}|${view.revId || ''}|${view.revPage ?? ''}` : null;
}

export class ItemsPanel extends EventTarget {
  constructor({ root, listEl, floorFilterEl, groupFilterEl, costToggleEl, footEl, project, host,
    sheetChipEl = null, titleEl = null }) {
    super();
    this.root = root;
    this.listEl = listEl;
    this.floorFilterEl = floorFilterEl;
    this.groupFilterEl = groupFilterEl;
    this.costToggleEl = costToggleEl;
    this.footEl = footEl;
    this.sheetChipEl = sheetChipEl;
    this.titleEl = titleEl;
    this.project = project;
    this.host = host || {};

    this.costFilter = 'all';
    this.floorFilter = null;
    this.groupFilter = null;
    /** Collapse state lives on the panel and is never persisted. */
    this.collapsed = new Set();
    this.selected = new Set();
    this._repop = false;
    /** The tree the last refresh listed (floor -> category -> sub ->
     *  [[page, item]]): what Collapse all folds, and the rows under a
     *  heading. View state, like `collapsed`. */
    this._tree = new Map();
    /** How many rows the last refresh listed, and whether the one-time hold
     *  hint has been said -- for this page's life, never saved. */
    this._listed = 0;
    this._hinted = false;
    /** Every item the last build listed (desktop _listed_ids): what the
     *  rename form counts as hidden by the filters is the rest. */
    this._listedIds = new Set();
    /** Which job this is: one more every time another comes in. A form
     *  asked about one job and answered in the next is no answer. */
    this._job = 0;
    /** The menu this list opened (the host's handle) and where the list
     *  stood then: a menu points at a row, so the list scrolling under it
     *  closes it. */
    this._menu = null;
    this._menuTop = 0;
    /** The SHEET chip (desktop 3.06): only what is drawn on the drawing on
     *  screen. A per-browser setting (SHEET_SETTING), off unless he turned
     *  it on, never written to a .takeoff. What the last build of one
     *  sheet's list found -- view state like `collapsed`:
     *    _here         Map {item: [its shapes painted here]}
     *    _sheetPages   Map {group_id: Set of its sheets}
     *    _sheetShapes  Map {group_id: how many shapes it has}
     *    _sheetView    the drawing it was built for {page, revId, revPage},
     *                  while its rows are the ones on screen
     *    _sheetKey     the same as a key (sheetKeyOf), null for no build
     *    _opening      the list says 'Opening …' (a drawing on its way)
     *    _soloCount    the items on no sheet then (NOT ON A SHEET opens on
     *                  one more). */
    this.sheetChip = false;
    this._here = new Map();
    this._sheetPages = new Map();
    this._sheetShapes = new Map();
    this._sheetView = null;
    this._sheetKey = null;
    this._opening = false;
    this._soloCount = null;
    this._sheetTimer = 0;
    /** How many times the list's rows were built: a page turn is one. */
    this.builds = 0;
    // Remembered from the last time, as the desktop's set_settings: a start
    // with it on folds the items on no sheet, as turning it on does.
    let on = false;
    try { on = !!this.host.settings?.get?.(SHEET_SETTING); } catch { on = false; }
    if (on) { this.collapsed.add(SOLO_KEY); this._soloCount = null; }
    this.sheetChip = on;
    this._syncChip();

    this._bind();
  }

  // ── one sheet: the SHEET chip ───────────────────────────────────────

  /** The drawing on screen, from the host, or null when there is no sheet
   *  for the list to be on: {page, revId, revPage, coming} -- `coming`
   *  while a drawing of it is still on its way (a turn, the newest drawing
   *  after it, a flip). */
  _view() {
    const v = this.host.view?.();
    if (!v || !Number.isInteger(v.page) || v.page < 0 || v.page >= (this.project.pageCount || 0)) return null;
    return v;
  }

  /** Is the list showing one sheet's takeoff right now? (desktop sheet_only) */
  sheetOnly() {
    return this.sheetChip && !!this._view();
  }

  /** The sheet the list is on, by its name -- '' when it is not on one --
   *  as every sentence of the chip names a sheet (the desktop's
   *  _page_final_label, CountingModel.pageLabel). */
  _sheetLabel(view) {
    if (!view) return '';
    const model = this._model || new CountingModel({ metadata: this.project.metadata,
      measurements: this.project.measurements, pageCount: this.project.pageCount });
    return model.pageLabel(view.page);
  }

  _syncChip() {
    const b = this.sheetChipEl;
    if (!b) return;
    b.classList.toggle('on', this.sheetChip);
    b.setAttribute('aria-pressed', this.sheetChip ? 'true' : 'false');
  }

  /** The chip pressed (desktop _on_sheet_chip): turned on, the items on no
   *  sheet start folded away -- the list is about the sheet now, and they
   *  are one tap from it. Remembered for the next time. */
  _onSheetChip() {
    const on = !this.sheetChip;
    if (on) {
      this.collapsed.add(SOLO_KEY);
      this._soloCount = null;
    }
    this.sheetChip = on;
    this._syncChip();
    try { this.host.settings?.set?.(SHEET_SETTING, on); } catch { /* the list still follows */ }
    this.refresh();
  }

  /**
   * The canvas turned the page or flipped the drawing (desktop
   * on_sheet_shown). With the chip off nothing runs: the full list is the
   * same on every sheet. With it on, once the changes have stopped, the
   * list is rebuilt -- only if the drawing on screen is not the one it was
   * built for, and not while a drawing is still on its way: the landing
   * says so again when it is up. A list saying 'Opening X1.2…' is rebuilt
   * the moment that drawing is up: the landing is the one decided word
   * (goToPage's), there is nothing left to wait out, and a turn onto a
   * sheet already decoded never shows the note at all.
   */
  onSheetShown() {
    if (!this.sheetChip) return;
    clearTimeout(this._sheetTimer);
    this._sheetTimer = 0;
    if (this._opening) {
      const v = this._view();
      if (v && !v.coming) { this.refresh(); return; }
    }
    this._sheetTimer = setTimeout(() => this._sheetTurned(), SHEET_FOLLOW_MS);
  }

  _sheetTurned() {
    this._sheetTimer = 0;
    if (!this.sheetChip) return;
    const v = this._view();
    if (v && v.coming) return;
    if (sheetKeyOf(v) !== this._sheetKey) this.refresh();
  }

  /** An item added with + while the list shows one sheet lands in the
   *  folded NOT ON A SHEET section: it is unfolded, so it is seen to arrive.
   *  Counted over the whole job, so a filter or a page turn never opens it
   *  (desktop _open_solo_on_add). */
  _openSoloOnAdd() {
    const n = soloCount(this.project.measurements);
    if (this._soloCount !== null && n > this._soloCount) this.collapsed.delete(SOLO_KEY);
    this._soloCount = n;
  }

  /** The title: 'ITEMS ON X1.1' while the list is on one sheet, cut at 12
   *  and said whole in its tooltip -- and, for a finger, by a tap on it. */
  _setTitle(label) {
    const t = this.titleEl;
    if (!t) return;
    t.textContent = sheetTitle(label);
    t.title = sheetTip(label);
    t.classList.toggle('sheet', !!label);
  }

  _sayTitle() {
    const label = this.sheetOnly() ? this._sheetLabel(this._view()) : '';
    if (label) this.host.say?.(sheetTip(label));
  }

  /** A line of text in the list: what the SHEET chip leaves out. */
  _sheetNote(text, empty = false) {
    const el = document.createElement('div');
    el.className = `sheet-note${empty ? ' empty' : ''}`;
    el.textContent = text;
    return el;
  }

  _bind() {
    this.costToggleEl?.addEventListener('click', ev => {
      const btn = ev.target.closest('button[data-cost]');
      if (!btn) return;
      this.costFilter = btn.dataset.cost;
      for (const b of this.costToggleEl.querySelectorAll('button')) {
        b.classList.toggle('on', b === btn);
      }
      this.refresh();
    });
    this.floorFilterEl?.addEventListener('change', () => {
      if (this._repop) return;
      this.floorFilter = this.floorFilterEl.value === '\x00ALL' ? null : this.floorFilterEl.value;
      this.refresh();
    });
    this.groupFilterEl?.addEventListener('change', () => {
      if (this._repop) return;
      this.groupFilter = this.groupFilterEl.value === '\x00ALL' ? null : this.groupFilterEl.value;
      this.refresh();
    });
    // A menu opened from the list points at the row or heading it was
    // opened on. When the list scrolls under it -- the held finger slid on
    // into a scroll, a wheel -- that row has moved away, and the menu goes
    // (a desktop menu holds the list still while it is open).
    this.listEl.addEventListener('scroll', () => {
      if (this._menu && Math.abs((this.listEl.scrollTop || 0) - this._menuTop) > 1) this._closeMenu();
    }, { passive: true });
    this.sheetChipEl?.addEventListener('click', () => this._onSheetChip());
    this.titleEl?.addEventListener('click', () => this._sayTitle());
    // Another job (every open and every new job resets the project first):
    // the drawing the list was built for is the last job's, and so is the
    // count of items on no sheet -- an opened job added none of its own.
    this.project.addEventListener?.('reset', () => {
      this._sheetView = null;
      this._sheetKey = null;
      this._soloCount = null;
      this._job += 1;
    });
    // An undo or redo of a rename (or a Set): the filters and the folded
    // headings it moved go back -- or forward -- with the names, before the
    // list is rebuilt (js/core/classify.js applyClassTool).
    this.project.addEventListener?.('class-tool', ev => applyClassTool(ev.detail,
      mv => mv[1] === this || mv[1] === this.collapsed));
  }

  /** A menu the list has just opened: the host's handle, or nothing. */
  _openedMenu(handle) {
    this._menu = handle || null;
    this._menuTop = this.listEl.scrollTop || 0;
  }

  /** Close the menu the list opened, if it is still the one on screen. */
  _closeMenu() {
    const handle = this._menu;
    this._menu = null;
    handle?.close?.();
  }

  setSelection(ids) {
    this.selected = new Set(ids);
    const lit = this._lights(this.selected);
    for (const row of this.listEl.querySelectorAll('.row')) {
      row.classList.toggle('on', lit(row));
    }
    this._scrollToRow(this.listEl.querySelector('.row.on'));
  }

  /**
   * Which rows a selection lights (desktop _apply_selection): the row of a
   * selected shape itself, or the row of the item a selected RUN belongs to.
   * A run of a multi-sheet item is not listed -- it rolls up into its item's
   * row -- and shares its item's group_id (data-gid on the row), so a run
   * tapped on its own sheet lights the item's row, as its main shape does.
   * (A group_id of '' is no group: the desktop never writes one.)
   */
  _lights(ids) {
    const gids = new Set();
    if (ids.size) {
      for (const [, it] of this.project.allItems()) {
        if (it.group_id && ids.has(it._uid)) gids.add(String(it.group_id));
      }
    }
    return row => ids.has(row.dataset.id) || (!!row.dataset.gid && gids.has(row.dataset.gid));
  }

  /**
   * Bring a row into view by scrolling the LIST, and nothing else (as
   * scrollIntoView's block 'nearest'). scrollIntoView scrolls every
   * ancestor that can scroll, an overflow:hidden one too: on a phone, with
   * the Items drawer shut, a tap on a shape on the drawing slid the whole
   * page 315 px sideways under the finger -- the tap's click then folded a
   * heading in the drawer, and the bar's buttons stayed off screen.
   */
  _scrollToRow(row) {
    const list = this.listEl;
    if (!row || !row.getBoundingClientRect || !list.getBoundingClientRect) return;
    const L = list.getBoundingClientRect();
    const R = row.getBoundingClientRect();
    let by = 0;
    if (R.top < L.top) by = R.top - L.top;
    else if (R.bottom > L.bottom) by = Math.min(R.bottom - L.bottom, R.top - L.top);
    if (by) list.scrollTop = (list.scrollTop || 0) + by;
  }

  /**
   * What was just selected ON THE DRAWING, found in the list (desktop
   * highlight_measurement): the sections its row is folded away in -- its
   * floor, its category, its sub-category -- are opened, the list is rebuilt
   * when one was folded, and its row is lit and scrolled to. Without this, a
   * Collapse all left every shape tapped on the sheet with no row to show.
   * The item is the one selected last (the desktop's selection is one item;
   * a Ctrl+click adds its item last). For a run of a multi-sheet item the
   * sections are the run's own (they are its item's, as add-shape writes
   * them) and the row is its item's (_lights); where two rows answer, the
   * last is scrolled to, as the desktop's target is.
   *
   * Only for a selection the desktop's list is told about (main.js: the
   * controller's `reveal`) -- not a right-click, not a finger's hold.
   */
  revealSelection(ids) {
    const list = [...ids];
    const m = list.length ? this.project.findItem(list[list.length - 1])?.item : null;
    if (m) {
      const fl = classStrip(m.floor_level);
      const cat = classStrip(m.category);
      const sub = classStrip(m.sub_category);
      const keys = [`fl\x00${fl}`, `cat\x00${fl}\x00${cat}`];
      if (sub) keys.push(`sub\x00${fl}\x00${cat}\x00${sub}`);
      let opened = false;
      for (const k of keys) if (this.collapsed.delete(k)) opened = true;
      if (opened) {
        this.selected = new Set(list);
        this.refresh();
      }
    }
    this.setSelection(list);
    if (m) {
      const its = [...this.listEl.querySelectorAll('.row')].filter(this._lights(new Set([m._uid])));
      this._scrollToRow(its[its.length - 1]);
    }
  }

  // ── build ───────────────────────────────────────────────────────────

  refresh() {
    const p = this.project;
    const floorsAll = [];
    const catsAll = [];
    let all = [];
    // What counts, asked once per rebuild: an item traced on a drawing its
    // sheet does not count from is LISTED -- it is his work and he can find
    // it -- but marked NOT COUNTED and left out of the totals at the foot,
    // exactly as the report leaves it out.
    this._model = this.host.counting?.() || new CountingModel({
      metadata: p.metadata, measurements: p.measurements, pageCount: p.pageCount });
    this._counts = new Map();

    for (const key of Object.keys(p.measurements)) {
      for (const m of p.measurements[key]) {
        if (EXCLUDED.has(m.type)) continue;
        if (m.group_child) continue;          // child shapes roll up into the master
        const fl = classStrip(m.floor_level);
        const cat = classStrip(m.category);
        // Collect every existing value BEFORE filtering, so the filter combos
        // always list what is in the project even when it is filtered out.
        if (!floorsAll.includes(fl)) floorsAll.push(fl);
        if (!catsAll.includes(cat)) catsAll.push(cat);
        if (this.costFilter !== 'all' && (m.cost_type || 'material') !== this.costFilter) continue;
        if (this.floorFilter !== null && fl !== this.floorFilter) continue;
        if (this.groupFilter !== null && cat !== this.groupFilter) continue;
        all.push([Number(key), m]);
        this._counts.set(m, this._model.itemCountsTowards(Number(key), m));
      }
    }
    // What this build lists, by item (desktop _listed_ids) -- the rename
    // form's 'hidden by the list's filters' is every other item it renames.
    // The desktop lists a Group container whenever the filters let it
    // through, so one counts as listed here too, though the web shows no
    // Group section: the sentence is the desktop's for the same job.
    const boxes = [];
    for (const key of Object.keys(p.measurements)) {
      for (const m of p.measurements[key]) {
        if (m.type !== 'group' || m.group_child) continue;
        if (this.costFilter !== 'all' && (m.cost_type || 'material') !== this.costFilter) continue;
        if (this.floorFilter !== null && classStrip(m.floor_level) !== this.floorFilter) continue;
        if (this.groupFilter !== null && classStrip(m.category) !== this.groupFilter) continue;
        boxes.push(m);
      }
    }
    this._listedIds = new Set([...all.map(([, m]) => m), ...boxes]);

    const emptyLast = (a, b) => (a === '') - (b === '') || a.localeCompare(b);
    floorsAll.sort(emptyLast);
    catsAll.sort(emptyLast);
    this._repopulateFilters(floorsAll, catsAll);

    this.listEl.textContent = '';
    this._tree = new Map();
    this._listed = 0;
    // One sheet (the SHEET chip): said in the title. What the list was
    // built for is remembered, so a turn that shows the same drawing again
    // rebuilds nothing.
    const view = this.sheetChip ? this._view() : null;
    const label = this._sheetLabel(view);
    this._setTitle(label);
    this._sheetKey = null;
    // The drawing the rows on screen were built for -- only while they are
    // on screen: a build of the full list (the chip off), of 'Opening …' or
    // of an empty list forgets it, so a drawing still coming is never shown
    // rows built before (the chip off and on again, a turn away and back)
    // as if they were the rows he was just looking at.
    const was = this._sheetView;
    this._sheetView = null;
    this._opening = false;
    this._here = new Map();
    this._sheetPages = new Map();
    this._sheetShapes = new Map();
    if (!all.length) {
      this.listEl.appendChild(this._emptyState());
      this._updateFoot([]);
      return;
    }

    // Backfill sort_order in +100 steps for anything created without one.
    let curMax = Math.max(0, ...all.map(([, m]) => Number(m.sort_order) || 0));
    for (const [, m] of all) {
      if (m.sort_order === undefined) { curMax += 100; m.sort_order = curMax; }
    }

    // The footer keeps the whole job's totals while the list shows one
    // sheet, and says so ('Whole job:'): what is listed is a part of it.
    const whole = all;
    let notes = null;
    let solo = null;
    if (view) {
      // A drawing still on its way: a turned-to sheet still decoding, or its
      // newest drawing after it. The rows of the drawing that WILL be up are
      // not known yet -- it says so, under the new sheet's title. A drawing
      // of the sheet the list is already on (a flip, a re-read) keeps the
      // rows of the one he was looking at until it lands.
      const built = !view.coming ? view : (was && was.page === view.page ? was : null);
      if (!built) {
        this.listEl.appendChild(this._sheetNote(`Opening ${label}…`, true)).classList.add('opening');
        this._opening = true;
        this._updateFoot(whole, true);
        return;
      }
      const sheet = sheetRows(this._model, all, built);
      this._sheetView = { page: built.page, revId: built.revId || '', revPage: built.revPage ?? null };
      this._sheetKey = sheetKeyOf(this._sheetView);
      this._here = sheet.here;
      this._sheetPages = sheet.pages;
      this._sheetShapes = sheet.shapes;
      solo = new Set(sheet.solo.map(([, m]) => m));
      all = [...sheet.rows, ...sheet.solo];
      // One sheet lists its rows, each Group one of them is in, and the
      // items on no sheet (desktop _sheet_rows).
      const inBoxes = new Set(sheet.rows.map(([, m]) => String(m.in_group || '')));
      this._listedIds = new Set([...all.map(([, m]) => m),
        ...boxes.filter(b => b.group_item_id && inBoxes.has(String(b.group_item_id)))]);
      this._openSoloOnAdd();
      notes = sheetNotes(sheet, label);
    }
    this.builds += 1;

    const tree = new Map();
    for (const [pg, m] of all) {
      const fl = solo && solo.has(m) ? SOLO : classStrip(m.floor_level);
      const cat = classStrip(m.category);
      const sub = classStrip(m.sub_category);
      if (!tree.has(fl)) tree.set(fl, new Map());
      const cats = tree.get(fl);
      if (!cats.has(cat)) cats.set(cat, new Map());
      const subs = cats.get(cat);
      if (!subs.has(sub)) subs.set(sub, []);
      subs.get(sub).push([pg, m]);
    }
    this._tree = tree;
    this._listed = all.length;
    // (with the chip on, `all` is this sheet's rows and the items on no sheet)

    const gmin = list => (list.length ? Math.min(...list.map(([, m]) => m.sort_order || 0)) : 0);
    const flatten = map => [...map.values()].flatMap(v => (v instanceof Map ? flatten(v) : v));

    let floors = [...tree.keys()].sort(
      (a, b) => gmin(flatten(tree.get(a))) - gmin(flatten(tree.get(b)))
    );
    // The items on no sheet go last whatever their numbers say: the list is
    // about the sheet.
    if (tree.has(SOLO)) floors = [...floors.filter(f => f !== SOLO), SOLO];

    const frag = document.createDocumentFragment();
    let parity = 0;
    // What the SHEET chip leaves out is said, never just missing: on top
    // when nothing is drawn here, under this sheet's rows otherwise.
    let footer = notes ? notes.footer : null;
    if (notes && notes.top) frag.appendChild(this._sheetNote(notes.top, true));

    floors.forEach((fl, fi) => {
      if (fl === SOLO && footer) {
        frag.appendChild(this._sheetNote(footer));
        footer = null;
      }
      const hue = fl === SOLO ? SOLO_HUE : GROUP_HUES[fi % GROUP_HUES.length];
      const cats = tree.get(fl);
      const flItems = flatten(cats);
      const flClosed = this.collapsed.has(`fl\x00${fl}`);
      // Each heading carries what it IS -- the raw floor, category and
      // sub-category its rows share, as the desktop's row meta does -- so
      // its menu and its tooltip are worked out from the same answer.
      frag.appendChild(this._groupHeader('floor', fl === SOLO ? SOLO_LABEL : (fl || 'No Floor Level'), flItems,
        flClosed, hue, null, `fl\x00${fl}`, { type: 'floor', fl, cat: null, sub: null }));
      if (flClosed) return;

      const catKeys = [...cats.keys()].sort(
        (a, b) => gmin(flatten(cats.get(a))) - gmin(flatten(cats.get(b)))
      );

      catKeys.forEach((cat, ci) => {
        const catLast = ci === catKeys.length - 1;
        const subs = cats.get(cat);
        const catItems = flatten(subs);
        const catClosed = this.collapsed.has(`cat\x00${fl}\x00${cat}`);
        frag.appendChild(this._groupHeader('cat', cat || 'Uncategorized', catItems,
          catClosed, hue, { cols: [], elbow: 0, last: catLast },
          `cat\x00${fl}\x00${cat}`, { type: 'cat', fl, cat, sub: null }));
        if (catClosed) return;

        const subKeys = [...subs.keys()].sort(
          (a, b) => gmin(subs.get(a)) - gmin(subs.get(b))
        );

        // Loose items and sub groups interleave in ONE ordered sequence, so
        // the elbow connectors land on the real last child. A loose item can
        // therefore sit between two sub-category groups.
        const entries = [];
        for (const sub of subKeys) {
          const items = subs.get(sub).slice()
            .sort((a, b) => (a[1].sort_order || 0) - (b[1].sort_order || 0));
          if (sub) entries.push(['sub', sub, items]);
          else for (const it of items) entries.push(['item', it, items]);
        }

        const catCont = !catLast;
        entries.forEach((ent, ei) => {
          const last = ei === entries.length - 1;
          if (ent[0] === 'item') {
            const [pg, m] = ent[1];
            frag.appendChild(this._itemRow(pg, m, parity, hue,
              { cols: [catCont], elbow: 1, last }));
            parity ^= 1;
          } else {
            const [, sub, subItems] = ent;
            const key = `sub\x00${fl}\x00${cat}\x00${sub}`;
            const subClosed = this.collapsed.has(key);
            frag.appendChild(this._groupHeader('sub', sub, subItems, subClosed, hue,
              { cols: [catCont], elbow: 1, last }, key, { type: 'sub', fl, cat, sub }));
            if (subClosed) return;
            const subCont = !last;
            subItems.forEach(([pg, m], ii) => {
              frag.appendChild(this._itemRow(pg, m, parity, hue,
                { cols: [catCont, subCont], elbow: 2, last: ii === subItems.length - 1 }));
              parity ^= 1;
            });
          }
        });
      });
    });

    if (footer) frag.appendChild(this._sheetNote(footer));
    this.listEl.appendChild(frag);
    this.setSelection(this.selected);
    this._updateFoot(whole, !!view);
    this.maybeHint();
  }

  /**
   * The one-time hint: an iPad shows no tooltip, so the first time the list
   * is ON SCREEN with a heading or a row in it while the layout is touch, the
   * status line says how a finger opens their menus. Once for this page's
   * life (a session) -- never saved, no setting. Asked after every rebuild,
   * and by the app whenever the list may have come on screen (a drawer
   * opened, the panel shown again, the layout switched). The host may say it
   * later (when the status line is free); if by then the layout is not touch
   * or the list is off screen, it is dropped unsaid and asked for again the
   * next time all of it is true.
   */
  maybeHint() {
    if (this._hinted || !this._hintDue()) return;
    this._hinted = true;
    this.host.hint?.(HOLD_HINT, {
      still: () => this._hintDue(),
      dropped: () => { this._hinted = false; },
    });
  }

  _hintDue() {
    return !!this._listed && !!this.host.touchLayout?.() && !!this.host.listShown?.();
  }

  // ── a heading's menu ────────────────────────────────────────────────

  /**
   * What a heading's menu offers besides Collapse all and Expand all --
   * 'rename', 'assign', 'group' or '' -- asked by the menu AND the tooltip,
   * so the tooltip cannot promise what the menu does not have (desktop
   * _header_act; tests/heading-menu.mjs holds both to it). '' until the web
   * can rename and set from a heading (the host's canClassifyFromHeadings,
   * the one switch), and '' whenever the list is read-only (a version up,
   * View Only): neither may offer a write.
   */
  _headerAct(meta) {
    if (!this.host.canClassifyFromHeadings?.() || this.host.readOnly?.()) return '';
    return headerAct(meta);
  }

  /** The heading's tooltip, from the same act as its menu (desktop
   *  _header_tip): no 'Drag to reorder', the web cannot reorder; in the
   *  touch layout the same sentence in a finger's words. */
  _headerTitle(meta) {
    return headerTip(meta, {
      canDrag: false, act: this._headerAct(meta), touch: !!this.host.touchLayout?.(),
    });
  }

  /**
   * The heading menu's entries, as the desktop's _show_header_menu builds
   * them: the act's entry and a rule when there is one, then Collapse all
   * (every section listed now folds) and Expand all (everything unfolds).
   * The tree and the rows are the ones listed when the menu opened, as the
   * desktop's meta carries them. A Set files THOSE rows, found again when
   * it is chosen by who they are, not by where the heading sits then
   * (classify.js rowsNow): the desktop's menu is modal, the web's is not --
   * an Undo while it is up puts a copy of every item in the job, and a page
   * turn with the SHEET chip on rebuilds the list for the next sheet under
   * it (a row is a snapshot: carry its identity, re-derive it on the
   * click). A menu opened in one job writes nothing in the next.
   */
  _headerEntries(meta) {
    const act = this._headerAct(meta);
    const job = this._job;
    const tree = this._tree;
    const rows = rowsUnder(tree, meta);
    const what = HDR_WHAT[HDR_FIELD[meta.type]] || '';
    const label = act === 'group' ? 'Rename group…'
      : act === 'rename' ? `Rename ${what}…`
        : act === 'assign' ? (rows.length === 1 ? `Set ${what} for this item…`
          : `Set ${what} for these ${rows.length} items…`)
          : '';
    const out = [];
    if (label) {
      out.push({
        label,
        run: () => {
          // Asked again HERE, not only when the menu was built: a menu opened
          // while editing stays on screen when the gate closes under it -- a
          // version flip -- and its write must not go through then. Nor in
          // another job: an open does not close it either.
          if (this._job !== job || this._headerAct(meta) !== act) return;
          this.host.classifyFromHeading?.(act, meta,
            act === 'assign' ? rowsNow(this.project.measurements, rows, HDR_FIELD[meta.type]) : rows);
        },
      });
      out.push('-');
    }
    out.push({
      label: 'Collapse all',
      run: () => {
        for (const fl of tree.keys()) this.collapsed.add(`fl\x00${fl}`);
        this.refresh();
      },
    });
    out.push({
      label: 'Expand all',
      run: () => { this.collapsed.clear(); this.refresh(); },
    });
    return out;
  }

  _headerMenu(meta, at) {
    this._openedMenu(this.host.showMenu?.(this._headerEntries(meta), at));
  }

  // ── renaming a heading, and filing the items under a blank one ──────
  //
  // A heading is not a thing of its own: it is the floor level, category or
  // sub-category its rows share, so renaming it rewrites that string on
  // every item that carries it, job-wide (js/core/classify.js
  // renameClassification). A blank heading -- NO FLOOR LEVEL, Uncategorized
  // -- has no name to change; its menu files the items listed under it
  // instead. Both ask in the desktop's form (host.askClassification) and
  // write one undo level. The form is not modal to the rest of the page the
  // way the desktop's is, so what it was asked about is checked again when
  // it is answered: the same job, the list still allowed to write.

  /** What the step did, said until the history moves past it (the host's
   *  sayStep; its plain say where it has none). */
  _sayStep(text) {
    if (this.host.sayStep) this.host.sayStep(text);
    else this.host.say?.(text);
  }

  /** Is the answer to a form still the answer for this heading? */
  _stillAsked(job, meta, act) {
    return job === this._job && this._headerAct(meta) === act;
  }

  /**
   * Rename a floor level, category or sub-category from its heading (desktop
   * _rename_from_header). The whole job: renaming a heading is fixing a
   * name, and a name is the same name everywhere in the job. A Group
   * section's 'Only the items in the group' waits until the web lists Group
   * sections (the user's decision 4).
   */
  async renameFromHeader(meta) {
    const field = HDR_FIELD[meta.type];
    if (!field) return;
    const what = HDR_WHAT[field];
    const fl = String(meta.fl || '');
    const old = classStrip({ floor_level: fl, category: meta.cat, sub_category: meta.sub }[field]);
    if (!old) return;
    const job = this._job;
    // A sub-category belongs to its category: the same 'Exterior' can sit
    // under Walls and under Doors, and renaming one is not renaming the other.
    const base = {};
    if (field === 'sub_category') base.category = classStrip(meta.cat);
    const listed = this._listedIds;
    const describe = opt => renameWhat(this.project.measurements, field, old, base, opt, listed);
    const presets = { floor_level: FLOOR_LEVEL_PRESETS, category: CATEGORY_PRESETS }[field] || [];
    const { own, rest } = classLists(this.project.measurements, field, base.category ?? null, presets);
    const got = await this.host.askClassification?.({
      title: `Rename ${pyTitle(what)}`,
      label: `New name for the ${what} '${old}':`,
      current: old, own, rest, describe, options: null,
      notes: renameNotes(field, old), old,
    });
    if (!got || !this._stillAsked(job, meta, 'rename')) return;
    let nu = got.name;
    if (classNameProblem(nu) || nu === old) return;
    const scope = { ...base };
    if (got.option) scope.group = got.option;
    const plan = classificationPlan(this.project.measurements, field, old, scope);
    if (!plan.length) {
      this.host.say?.(`Nothing is filed under '${old}' any more`);
      return;
    }
    // A name the job already has, in any capitals or spacing: a merge into
    // the spelling that is there -- asked first, No the default.
    const into = existingSpelling(this.project.measurements, field, nu, old, base.category ?? null);
    if (into !== null) {
      const yes = await this.host.askYesNo?.(`Merge ${pyTitle(what)}`,
        mergeQuestion(this.project.measurements, field, plan, into, base));
      if (!yes || !this._stillAsked(job, meta, 'rename')) return;
      nu = into;
    }
    // The list's own state first: the rename rebuilds the list, and a
    // filter whose value has gone falls back to All without a word. One
    // Undo puts these back with the names (`also`).
    const was = [this.floorFilter, this.groupFilter];
    const folds = followRename(this, field, old, nu, scope);
    const also = [['attr', this, 'floorFilter', was[0], this.floorFilter],
      ['attr', this, 'groupFilter', was[1], this.groupFilter], ...folds];
    const counts = renameClassification(this.project, field, old, nu, scope,
      { followTool: this.host.followTool || null, also });
    if (!counts || !Object.keys(counts).length) return;
    this._sayStep(renameSaid(field, old, nu, into !== null, counts));
  }

  /**
   * NO FLOOR LEVEL ▸ Set floor level for these items (and the same for
   * Uncategorized): file the rows listed under a blank heading (desktop
   * _assign_from_header). `rows` are the ones its menu named, as the job
   * holds them when the entry is chosen (classify.js rowsNow).
   */
  async assignFromHeader(meta, rows) {
    const field = HDR_FIELD[meta.type];
    if (field !== 'floor_level' && field !== 'category') return;
    const what = HDR_WHAT[field];
    const hdr = field === 'floor_level' ? 'NO FLOOR LEVEL' : 'Uncategorized';
    // Said, never silent: nothing filed must not read as filed.
    const gone = () => this.host.say?.(`Nothing is listed under ${hdr} any more`);
    const job = this._job;
    const store = this.project.measurements;
    const listed = (rows || []).filter(isClassRow);
    if (!listed.length) { gone(); return; }
    const unfiled = unfiledItems(store, field);
    const sheets = sheetsOfGroups(store);
    const filtered = this._filtering() || this.sheetOnly();
    const describe = opt => assignWhat(field, opt === 'job' ? unfiled : listed,
      opt !== 'job' && filtered, sheets);
    const presets = field === 'floor_level' ? FLOOR_LEVEL_PRESETS : CATEGORY_PRESETS;
    const { own, rest } = classLists(store, field, null, presets);
    const got = await this.host.askClassification?.({
      title: `Set ${pyTitle(what)}`,
      label: `${pyCapitalize(what)} for these items:`,
      current: '', own, rest, describe, options: assignOptions(field, listed, unfiled),
      notes: [], old: null,
    });
    if (!got || !this._stillAsked(job, meta, 'assign')) return;
    let nu = got.name;
    if (classNameProblem(nu)) return;
    // Filing under a floor that exists, spelled however he typed it, is
    // filing under THAT floor -- never a look-alike second heading.
    nu = existingSpelling(this.project.measurements, field, nu, null) ?? nu;
    const targets = got.option === 'job' ? unfiled : listed;
    const tids = new Set(targets);
    // Nothing is left unfiled, so a list filtered to the blank would be
    // empty -- and fall back to All. It follows the items instead (and an
    // Undo puts it back on the blank with them).
    const also = [];
    if (!unfiled.some(m => !tids.has(m))) {
      if (field === 'floor_level' && this.floorFilter === '') {
        also.push(['attr', this, 'floorFilter', '', nu]);
        this.floorFilter = nu;
      } else if (field === 'category' && this.groupFilter === '') {
        also.push(['attr', this, 'groupFilter', '', nu]);
        this.groupFilter = nu;
      }
    }
    const counts = assignClassification(this.project, field, nu, targets, { also });
    if (!counts || !Object.keys(counts).length) {
      // Nothing was filed (every row it was asked about has gone since):
      // nor is the filter moved -- and he is told.
      for (const [, holder, name, was] of also) holder[name] = was;
      if (counts) gone();
      return;
    }
    this._sayStep(assignSaid(field, counts, nu));
  }

  /** The item as the totals see it (a multi-sheet item: the runs that count). */
  _counted(pageIdx, m) {
    if (!(m.group_id && !m.group_child) || !this._model) return m;
    const [q] = this._model.countedQty(pageIdx, m);
    return q === m.value ? m : { ...m, value: q };
  }

  /** Why an item is not in the totals, in his words. '' when it is. */
  _whyNotCounted(pageIdx, m) {
    if (!this._model || this._counts.get(m) !== false) return '';
    const md = this._model;
    const waiting = md.waitingReason(pageIdx, m);
    if (waiting) return `NOT COUNTED — ${waiting}.`;
    const rid = String(m.rev_id || '');
    return `NOT COUNTED — taken off on ${md.versionName(rid)}; `
      + `${md.pageLabel(pageIdx)} counts from ${md.versionName(md.workingVersionOf(pageIdx))}. `
      + 'It is kept, and it is not in your totals or any report.';
  }

  _emptyState() {
    const el = document.createElement('div');
    el.className = 'empty-list';
    if (this.floorFilter !== null || this.groupFilter !== null) {
      el.textContent = 'No items match the\ncurrent filters.';
    } else if (this.costFilter === 'labor') {
      el.textContent = 'No labor items.\n\nSet an item’s Type\nto Labor in its\nproperties dialog.';
    } else if (this.costFilter === 'material') {
      el.textContent = 'No material items.';
    } else {
      el.textContent = 'No items yet.\n\nDraw with Area,\nPolyline or Count —\nor use the + button\nfor something that\nisn’t on a sheet.';
    }
    return el;
  }

  _repopulateFilters(floors, cats) {
    this._repop = true;
    fill(this.floorFilterEl, 'All Floors', floors, '(No Floor Level)', this.floorFilter);
    fill(this.groupFilterEl, 'All Groups', cats, '(Uncategorized)', this.groupFilter);
    this._repop = false;
    // The previously selected value may have vanished — an item was
    // recategorised. Re-read rather than leaving a filter pointing at nothing.
    this.floorFilter = this.floorFilterEl.value === '\x00ALL' ? null : this.floorFilterEl.value;
    this.groupFilter = this.groupFilterEl.value === '\x00ALL' ? null : this.groupFilterEl.value;
  }

  _groupHeader(kind, text, items, closed, hue, tree, key, meta) {
    const spec = {
      floor: { txt: 1.00, bg: 0.20, upper: true },
      cat: { txt: 0.78, bg: 0.10, upper: false },
      sub: { txt: 0.58, bg: 0.05, upper: false },
    }[kind];

    const el = document.createElement('div');
    el.className = `grp ${kind}`;
    el.style.background = mix(hue, spec.bg);
    if (kind === 'floor') el.style.borderLeftColor = mix(hue, 0.9);

    if (tree) el.appendChild(gutterEl(tree, mix(hue, 0.5)));

    const label = document.createElement('div');
    label.className = 'grp-label';
    label.style.color = mix(hue, spec.txt, '#9a9a9a');
    const disp = spec.upper ? text.toUpperCase() : text;
    label.textContent = `${closed ? '▸' : '▾'} ${disp}${closed ? `  (${items.length})` : ''}`;
    el.appendChild(label);

    // The desktop shows NO quantity on a tree header — a collapsed one shows
    // only the item count. Reproduce that: a rollup here would have to answer
    // "how much of what" for a group holding square feet, feet and each, and
    // the report engine is where that question is actually answered.
    const qty = document.createElement('span');
    qty.className = 'grp-qty';
    qty.textContent = closed ? '' : `${items.length}`;
    qty.title = `${items.length} item${items.length === 1 ? '' : 's'}`;
    el.appendChild(qty);

    el.title = this._headerTitle(meta);
    el.addEventListener('click', () => {
      if (this.collapsed.has(key)) this.collapsed.delete(key);
      else this.collapsed.add(key);
      this.refresh();
    });
    // Its menu: a finger held on it (an iPad sends no 'contextmenu' for
    // one), or the right button / a two-finger click. A finger's
    // 'contextmenu' (Chrome, Android) is the hold's: one menu, not two.
    // (A hold the lift's own time shows was a tap gives its menu back.)
    const hold = holdGesture(el, {
      onHold: at => this._headerMenu(meta, at),
      onTakeBack: () => this._closeMenu(),
    });
    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      if (hold.busy()) return;
      this._headerMenu(meta, ev);
    });
    return el;
  }

  _itemRow(pageIdx, m, parity, hue, tree) {
    const solo = m.type === 'standalone';
    // A standalone always renders as visible: it draws nothing, so "hidden"
    // is meaningless, and isolating a drawn item must not grey out every
    // hand-added line in the estimate.
    const visible = solo ? true : m.visible !== false;

    // One sheet (the SHEET chip): the takeoff painted on the drawing on
    // screen, and a mark about THAT takeoff -- the item's first shape may be
    // on another sheet, counted from another of its drawings.
    const here = solo ? null : this._here.get(m) || null;
    const sheetPage = here ? this._sheetView.page : null;
    const countedHere = here ? countsHere(this._model, sheetPage, here) : null;
    const why = here
      ? (countedHere ? '' : notCountedHereWhy(this._model, sheetPage, pageIdx, m, here))
      : this._whyNotCounted(pageIdx, m);
    const el = document.createElement('div');
    el.className = `row${visible ? '' : ' hidden'}${why ? ' nc' : ''}`;
    el.dataset.id = m._uid;
    // A multi-sheet item's runs are lit through it (_lights).
    if (m.group_id) el.dataset.gid = String(m.group_id);
    if (why) el.title = why;
    el.style.background = parity === 0 ? '#191919' : '#1e1e1e';

    el.appendChild(gutterEl(tree, mix(hue, 0.5)));

    const dot = document.createElement('span');
    dot.className = 'dot';
    const c = m.color;
    dot.style.background = (Array.isArray(c) && c.length >= 3)
      ? `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
      : '#4da6e8';
    el.appendChild(dot);

    const col = document.createElement('div');
    col.className = 'col';

    const nm = document.createElement('div');
    nm.className = 'nm';
    const badge = document.createElement('span');
    const labor = (m.cost_type || 'material') === 'labor';
    badge.className = `badge ${labor ? 'L' : 'M'}`;
    badge.textContent = labor ? 'L' : 'M';
    badge.title = labor ? 'Labor item' : 'Material item';
    nm.appendChild(badge);
    const nameSpan = document.createElement('span');
    nameSpan.textContent = displayName(m);
    nm.appendChild(nameSpan);
    if (why) {
      // Colour is never the only signal: the words say it.
      const tag = document.createElement('span');
      tag.className = 'nc-tag';
      // On one sheet, the desktop's ⊘: what is painted HERE is not counted
      // (the item may well be, from its shapes on other sheets). A finger
      // gets its sentence by a tap, which steps nothing.
      tag.textContent = here ? '⊘ NOT COUNTED' : 'NOT COUNTED';
      tag.title = why;
      if (here) {
        tag.addEventListener('click', ev => {
          ev.stopPropagation();
          this.host.say?.(why);
        });
      }
      nm.appendChild(tag);
    }
    col.appendChild(nm);

    // On one sheet: this sheet's quantity, then the whole item's, when that
    // is something else ('35.0 sq ft   ·  65.0 sq ft in all'); an item all
    // here, and counted, in the desktop's own words for it.
    const vs = here
      ? sheetValueStr(this._model, pageIdx, m, here, countedHere, this._sheetShapes)
      : valueString(this._counted(pageIdx, m));
    if (vs) {
      const v = document.createElement('div');
      v.className = 'val';
      v.textContent = vs;
      col.appendChild(v);
    }

    const notes = notesWithPurpose(m);
    if (notes) {
      const n = document.createElement('div');
      n.className = 'nt';
      n.textContent = notes.length > 70 ? `${notes.slice(0, 70)}…` : notes;
      col.appendChild(n);
    }

    const nMats = (m.associated_items || []).length;
    if (nMats) {
      const mm = document.createElement('div');
      mm.className = 'mats';
      mm.textContent = `⊕ ${nMats} material${nMats !== 1 ? 's' : ''}`;
      col.appendChild(mm);
    }
    el.appendChild(col);

    const side = document.createElement('div');
    side.className = 'side';
    const acts = document.createElement('div');
    acts.className = 'acts';
    // Hide and Materials both WRITE to the project — `visible` is a saved
    // field and setVisible goes through transact, so a stray click on the eye
    // in View Only would dirty the file and hide real takeoff from the
    // estimate. A control that would be refused is not shown at all.
    if (!solo && !this.host.readOnly?.()) {
      const matBtn = document.createElement('button');
      matBtn.className = 'act';
      matBtn.textContent = '⊕';
      matBtn.title = 'Manage associated materials';
      matBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        this.host.openMaterials?.(m);
      });
      acts.appendChild(matBtn);

      const eye = document.createElement('button');
      eye.className = 'act eye';
      eye.textContent = visible ? '◉' : '◎';
      eye.title = visible ? 'Hide' : 'Show';
      eye.addEventListener('click', ev => {
        ev.stopPropagation();
        // Checked again HERE, not only when the row was built. `visible` is a
        // saved field written through transact(), and a row built while
        // editing was allowed stays in the DOM with a live handler when the
        // gate closes under it — which is exactly what a version flip does.
        if (this.host.readOnly?.()) return;
        this.project.setVisible([m._uid], !visible);
        this.refresh();
      });
      acts.appendChild(eye);
    }
    side.appendChild(acts);

    const pg = document.createElement('span');
    pg.className = `pg${solo ? ' solo' : ''}`;
    pg.textContent = solo ? 'no sheet' : this.host.pageLabel?.(pageIdx) ?? `Pag: ${pageIdx + 1}`;
    pg.title = solo
      ? 'Not drawn on any sheet — added by hand'
      : `Page ${pageIdx + 1}`;
    if (here) {
      // 'X1.0 +2': where the item lives, and that it reaches further. The
      // tooltip is the desktop's (its NOT COUNTED sentence is the tag's
      // here, in words that never call a counted item uncounted); a tap on
      // '+N' says the other sheets -- an iPad has no tooltip -- and steps
      // nothing.
      const w = sheetPageWords(this._model, pageIdx, m, here, countedHere, this._sheetPages);
      pg.textContent = w.text;
      pg.title = w.counts ? w.tip : w.tip.split('\n')[0];
      if (w.also.length) {
        pg.classList.add('also');
        const others = w.also.map(q => this._model.pageLabel(q)).join(', ');
        pg.addEventListener('click', ev => {
          ev.stopPropagation();
          this.host.say?.(`${displayName(m)} is also on ${others}`);
        });
      }
    }
    side.appendChild(pg);
    el.appendChild(side);

    el.addEventListener('click', ev => {
      this.host.selectItem?.(m, pageIdx, ev);
    });
    el.addEventListener('dblclick', () => this.host.openProperties?.(m));
    // The item menu: a finger held on the row, or the right button. Neither
    // touches the selection -- the desktop's right-click on a row does not
    // either (_ClickableRow: the press is the menu's, the row is not
    // clicked) -- and the hold's lift is swallowed, so it selects nothing.
    const hold = holdGesture(el, {
      onHold: at => this._openedMenu(this.host.showItemMenu?.(m, at)),
      onTakeBack: () => this._closeMenu(),
    });
    el.addEventListener('contextmenu', ev => {
      ev.preventDefault();
      if (hold.busy()) return;
      this._openedMenu(this.host.showItemMenu?.(m, ev));
    });
    return el;
  }

  /** Is the cost, floor or group filter taking anything out? */
  _filtering() {
    return this.costFilter !== 'all' || this.floorFilter !== null || this.groupFilter !== null;
  }

  _updateFoot(pairs, wholeJob = false) {
    if (!this.footEl) return;
    if (!pairs.length) { this.footEl.textContent = ''; return; }
    // While the list shows one sheet the totals are still the whole job's
    // (the reports' and the exports'), and the line says so -- as filtered
    // when ALL / LAB / MAT, the floor or the group filter is narrowing them,
    // exactly as with the chip off: 'Whole job:' over a filtered total
    // would claim the job is that much.
    const lead = !wholeJob ? '' : this._filtering() ? 'Whole job, filtered: ' : 'Whole job: ';
    // Only what COUNTS is totalled: an item on a drawing its sheet is not
    // counted from is in no total, here or in any report. How many were left
    // out is said beside the total, so the two can be checked.
    const items = pairs.filter(([, m]) => this._counts.get(m) !== false)
      .map(([pg, m]) => this._counted(pg, m));
    const left = pairs.length - items.length;
    // unitTotals wants {qty, unit} entries. A raw measurement carries neither
    // — only `value` — so passing them straight in totalled nothing but the
    // hand-added standalone items.
    const totals = unitTotals(items.map(m => reportQty(m)).filter(Boolean));
    // The money is what the reports add (collectItems, the desktop Report
    // Center's _collect): each item's own line by their rule (itemCost: a
    // count by its points, an array by its whole dots, every pin -- a
    // partition and a header too -- as one, an item on no sheet by its typed
    // quantity) and its materials -- none of either for a kind the reports do
    // not list (no quantity: a pitch).
    let cost = 0;
    for (const m of items) {
      if (!reportQty(m)) continue;
      cost += itemCost(m);
      for (const line of expandAssembly(m)) cost += line.cost;
    }
    const nc = left ? `   ·   ${left} not counted` : '';
    this.footEl.textContent = lead + (cost > 0
      ? `${items.length} items   ·   ${totals}   ·   ${money(cost)}${nc}`
      : `${items.length} items   ·   ${totals}${nc}`);
    this.footEl.title = left
      ? `${left} item${left === 1 ? ' is' : 's are'} taken off on a drawing ${left === 1 ? 'its sheet does' : 'their sheets do'} not count from — marked NOT COUNTED above, and in no total.`
      : '';
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function fill(sel, allLabel, values, emptyLabel, current) {
  if (!sel) return;
  sel.textContent = '';
  const optAll = document.createElement('option');
  optAll.value = '\x00ALL';
  optAll.textContent = allLabel;
  sel.appendChild(optAll);
  for (const v of values) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = v === '' ? emptyLabel : v;
    sel.appendChild(o);
  }
  sel.value = current !== null && values.includes(current) ? current : '\x00ALL';
}

/**
 * The connector lines that make the tree read as a tree.
 *
 * Rows stack with no gap and carry no border, deliberately: a 1px separator
 * would cut every vertical and the elbows would stop joining up.
 */
function gutterEl(tree, color) {
  const el = document.createElement('span');
  el.className = 'gutter';
  if (!tree) return el;
  const COL = 12;
  const w = COL * (tree.elbow + 1);
  el.style.width = `${w}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', '100%');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.style.width = `${w}px`;
  const lines = [];
  tree.cols.forEach((on, d) => {
    if (on) lines.push([d * COL + 6, 0, d * COL + 6, '100%']);
  });
  const x = tree.elbow * COL + 6;
  lines.push([x, 0, x, tree.last ? '50%' : '100%']);
  lines.push([x, '50%', w, '50%']);
  for (const [x1, y1, x2, y2] of lines) {
    const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ln.setAttribute('x1', String(x1)); ln.setAttribute('x2', String(x2));
    ln.setAttribute('y1', String(y1)); ln.setAttribute('y2', String(y2));
    ln.setAttribute('stroke', color);
    ln.setAttribute('stroke-width', '1');
    ln.setAttribute('shape-rendering', 'crispEdges');
    svg.appendChild(ln);
  }
  el.appendChild(svg);
  return el;
}

/** The footer's whole dollars (web-only: the desktop's list has no footer), rounded as Python rounds. */
function money(v) {
  const n = Number(v);
  return `$${pyFixed(Number.isNaN(n) ? 0 : n, 0, true)}`;
}

export { STANDALONE_PAGE };

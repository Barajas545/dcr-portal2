// project.js — the whole document, and every edit that can be undone.
//
// STORAGE MODEL (identical to the desktop app, so files round-trip):
//
//   measurements  { pageKey: [item, …] }   takeoff work — what gets estimated
//   annotations   { pageKey: [annot, …] }  markup — text, images, CAD entities
//
// A pageKey is a page index, or STANDALONE_PAGE for work that belongs to the
// job rather than to any one sheet. Page inserts, deletes and reorders shift
// the numeric keys and must carry the standalone bucket through untouched.
//
// THE TAKEOFF TREE IS NOT STORED. Floor / category / sub-category grouping is
// derived at display time from three string fields on each item —
// floor_level, category, sub_category — ordered by sort_order. There is no
// separate tree structure to keep in sync, and adding one would be a bug.
//
// UNDO is a snapshot of the two stores plus the page order. Items are small
// and plain, structuredClone is fast, and a snapshot cannot go stale the way
// an inverse-operation log does when two features touch the same item.

import {
  STANDALONE_PAGE, shiftPageKey, comparePageKeys, intKeyed,
} from './takeoff-file.js';
import { DEFAULT_DPI, DEFAULT_PPF, scaleLabelFor } from './units.js';
import { polygonArea, pathLength } from './geom.js';
import { shapeOwn } from './measure.js';
import {
  remapPageIndices, insertMapper, deleteMapper, isTakeoffType, itemRevId,
} from './revisions.js';
import { CountingModel } from './counting.js';

export { STANDALONE_PAGE };

const UNDO_DEPTH = 60;

/**
 * Types that are never re-valued with the sheet.
 *
 * One member, and it is not an oversight: a reference distance is a reading
 * taken at a scale the estimator picked for that line alone, so "re-value
 * everything on this sheet" is precisely the operation it has to survive.
 */
export const KEEPS_OWN_SCALE = new Set(['ref_distance']);

/** Item types the takeoff panel and the estimate never include. */
// 'ref_distance' is the desktop's reference distance: a one-off
// measurement at a scale of its own, taken to read a detail without
// recalibrating the sheet. It is never a quantity, and this build
// opens the same files, so it must never be one here either.
// 'group' is the desktop's Group container: it holds items and is never
// bought. The same set as revisions.js isTakeoffType asks (NON_TAKEOFF plus
// the Measure ruler), so the panel, the reports and the totals agree.
export const NON_TAKEOFF_TYPES = new Set(['distance', 'textnote', 'page_ref', 'pitch', 'ref_distance', 'group']);

/** Every item type the canvas can hold. */
export const ITEM_TYPES = [
  'distance', 'area', 'slope_area', 'pitch', 'polyline', 'count',
  'window', 'door', 'linear_count', 'grid', 'tile', 'page_ref', 'textnote',
  // Drawn, saved, selected, dragged and deleted like anything else on the
  // sheet — just never counted. Leaving it out of this list did not keep the
  // files away; it only meant nothing here was written expecting one.
  'ref_distance',
];

// IDENTITY. The desktop format has NO id on a measurement item — Python uses
// object identity and the file carries nothing. So this build assigns `_uid` at
// load, uses it everywhere in the UI, and STRIPS IT ON SAVE.
//
// Persisting an invented id would be worse than useless: the desktop app's
// copy/paste and Add Shape both deep-copy an item, which would put two items
// carrying the same id back into a file this app then opens. Selection,
// deletion and the properties dialog would all address the wrong one.
let idCounter = 0;
/** A stable runtime id. Never reused within a session, never written to disk. */
export function newId(prefix = 'i') {
  idCounter += 1;
  const rand = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}${rand}`;
}

// Keys this app adds at load and must never write back.
//
// `ppf` in particular. It is tempting to persist the recovered scale, but the
// desktop app's Add Shape and paste both deep-copy an item — so a copy made
// there would carry a ppf from the sheet it came from while its value was
// computed on the sheet it landed on, and the two would disagree with nothing
// to say which is right. Recovering it fresh on every load from the item's own
// value and geometry is always self-consistent, and self-heals.
//
// That self-healing is the whole licence for stripping the key, so it has to
// hold for EVERY type whose value is a real-world measurement — the
// reference distance above all, whose stamp is the only record of a scale no
// sheet knows. It did not: recoverPpf had no case for it, so a save here
// wrote the line back without its ppf and the next open read a detail traced
// at 1" = 1 ft against the 1/4" plan it sits on. See the ref_distance case
// in recoverPpf, which is what makes stripping it safe here.
const RUNTIME_KEYS = ['_uid', 'ppf', 'ppf_recovered', 'scale_label', 'self_intersects'];

/** Deep copy of a store with every runtime-only key removed. */
function stripRuntimeKeys(store) {
  const out = {};
  for (const [k, list] of Object.entries(store)) {
    if (!Array.isArray(list) || !list.length) continue;
    out[String(k)] = list.map(item => {
      const copy = { ...item };
      for (const key of RUNTIME_KEYS) delete copy[key];
      return copy;
    });
  }
  return out;
}

export class Project extends EventTarget {
  constructor() {
    super();
    this.reset();
  }

  reset() {
    this.metadata = {
      project_name: '',
      internal_id_number: '',
      client_name: '',
      project_address: '',
      estimator_name: '',
      bid_date: '',
      project_type: '',
      project_status: '',
      project_description: '',
      project_notes: '',
      project_created: nowStamp(),
      project_modified: '',
      // The render resolution. The on-disk key is "dpi"; "import_dpi" is the
      // desktop app's SETTINGS key and never appears in a project file.
      dpi: DEFAULT_DPI,
      // Sheet identity, in the three shapes the desktop app actually uses.
      // page_labels is a LIST of auto-detected numbers; the other two are
      // DICTS keyed by a stringified page index. Writing either of them as a
      // list produces a file the desktop app cannot open.
      page_labels: [],
      page_labels_custom: {},
      page_names: {},
      page_scales: {},
      page_groups: {},
      cad_layers: defaultLayers(),
      cad_layer_current: '0',
      pixels_per_foot: DEFAULT_PPF,
      last_viewed_page: 0,
      revisions: [],
    };
    this.measurements = {};       // pageKey -> item[]
    this.annotations = {};        // pageKey -> annot[]
    this.pageCount = 0;

    this._undo = [];
    this._redo = [];
    this._dirty = false;
    this._txDepth = 0;
    this._txSnapshot = null;
    // Set at load when the file names revision sets whose images could not be
    // read. A save must not silently drop them — see loadFrom.
    this.revisionsUnreadable = false;
    this.filePath = '';           // display name of the opened file
    this.fileHandle = null;       // FileSystemFileHandle, when we have one
    this._isolation = null;       // transient "show only these" — never saved
  }

  // ── loading ──────────────────────────────────────────────────────────

  /**
   * Adopt an opened project file.
   *
   * `revisionCounts` is how many sheets each revision set in the file's
   * TKREVS01 tail holds, read out of the tail's INDEX. The desktop app pairs
   * each `metadata.revisions` record with a set of decoded images; this app
   * never holds those pixels — on the largest real job they run to 1.42 GB —
   * so it pairs each record with a page COUNT instead, and fetches one page
   * only when it is drawn.
   */
  loadFrom({ metadata, annotations, measurements, pageCount, revisionCounts = [] }) {
    this.reset();
    this.pageCount = pageCount;
    // Everything the writer folds in is stripped back out here, so metadata
    // stays the project's own fields and nothing else.
    const meta = { ...metadata };
    delete meta.annotations;
    delete meta.measurements;
    delete meta._rev_images;
    this.metadata = {
      ...this.metadata,
      ...meta,
      page_labels: Array.isArray(meta.page_labels) ? meta.page_labels.slice() : [],
      page_labels_custom: indexDict(meta.page_labels_custom),
      page_names: indexDict(meta.page_names),
      page_scales: normaliseScales(meta.page_scales),
      cad_layers: Array.isArray(meta.cad_layers) && meta.cad_layers.length
        ? meta.cad_layers : defaultLayers(),
      revisions: adoptRevisions(meta.revisions, revisionCounts),
    };
    // The file SAYS it has revision sets but the tail could not be read.
    //
    // `readRevisionIndex` answers [] for a truncated or corrupt tail, by
    // design — a bad tail must never cost the main project. But that leaves
    // the records with no pixels behind them, and a save composed from what
    // is in hand would then write those records with no TKREVS01 block at
    // all: up to 1.42 GB of drawings gone, in place, with nothing said.
    //
    // Recorded here and refused at the point of saving, where it can still be
    // stopped. Google Drive has truncated this estimator's files three times.
    this.revisionsUnreadable =
      (Array.isArray(meta.revisions) ? meta.revisions.length : 0) > 0
      && revisionCounts.length === 0;
    this.measurements = normaliseStore(measurements);
    this.annotations = normaliseStore(annotations);
    this._backfillItems();
    this._dirty = false;
    this.emit('loaded');
  }

  /**
   * Repair what a desktop-written file does not carry, and RECOVER the scale
   * each item was actually drawn at.
   *
   * This is the most important thing this class does, and it is not obvious.
   *
   * The desktop app keeps ONE scale for the whole project. An estimator
   * calibrates a sheet, draws, calibrates again for a detail, draws more — and
   * every item's stored `value` was computed at whatever the scale was AT THAT
   * MOMENT. Nothing records which. Measured against the live library, 11 of 76
   * checked items disagree with what the project's current scale would give:
   * one 1,381 sq ft area re-derives as 378 sq ft, a 73% error, straight into a
   * bid.
   *
   * So the ppf is not guessed from the page. It is recovered from the item
   * itself: the geometry is in pixels and the value is in feet, so their ratio
   * IS the scale that item was drawn at, exactly. Only where that cannot be
   * inverted — a count, a pin, a zero value — does the page's scale stand in.
   *
   * `value` is never recomputed here. What the estimator measured is what the
   * file says, and this app's job is to keep it that way.
   */
  _backfillItems() {
    for (const [key, list] of Object.entries(this.measurements)) {
      const pagePpf = this.pagePpf(Number(key));
      for (const it of list) {
        if (!it._uid) it._uid = newId('m');
        if (it.visible === undefined) it.visible = true;
        if (!(Number(it.ppf) > 0)) {
          const recovered = recoverPpf(it);
          it.ppf = recovered ?? pagePpf;
          it.ppf_recovered = recovered != null;
          if (!it.scale) it.scale_label = scaleLabelFor(it.ppf, this.dpi);
        }
      }
    }
    for (const list of Object.values(this.annotations)) {
      for (const a of list) if (!a._uid) a._uid = newId('a');
    }
  }

  /** Items whose scale had to be inferred rather than recovered. */
  itemsWithAssumedScale() {
    const out = [];
    for (const [key, it] of this.allItems()) {
      if (it.ppf_recovered === false && MEASURED_TYPES.has(it.type)) out.push([key, it]);
    }
    return out;
  }

  get dpi() {
    // "dpi" is the key in the file. Accept the settings spelling as a fallback
    // so a project this app wrote before the shapes were pinned still opens.
    const d = Number(this.metadata.dpi ?? this.metadata.import_dpi);
    return Number.isFinite(d) && d > 0 ? d : DEFAULT_DPI;
  }

  set dpi(v) { this.metadata.dpi = v; }

  // ── the metadata block a save writes ────────────────────────────────

  buildSaveMetadata({ baselineVisibility = null } = {}) {
    const meas = baselineVisibility || this.measurements;
    const meta = { ...this.metadata };
    meta.project_modified = nowStamp();
    // Runtime keys never reach the file. See the note on identity above.
    meta.annotations = stripRuntimeKeys(this.annotations);
    meta.measurements = stripRuntimeKeys(meas);
    // A revision record carries a page count this app derived from the file's
    // own tail, and possibly a placeholder for a set of blobs the metadata
    // never described. Neither belongs on disk. Written back untouched
    // otherwise, so a save still reproduces the file it opened.
    meta.revisions = revisionsForSave(this.metadata.revisions);
    return meta;
  }

  // ── page scale ──────────────────────────────────────────────────────
  //
  // TWO SCALES, and the difference is the one thing to get right here.
  //
  // The desktop app keeps ONE scale for the whole project, in
  // metadata.pixels_per_foot. That is the field this app must read and must
  // keep writing, or a project edited here opens on the desktop measuring
  // everything at the wrong scale.
  //
  // But a real drawing set is not drawn at one scale. Details are 1/2", plans
  // are 1/4", site plans are 1"=20'. So this build ALSO keeps page_scales,
  // { pageKey: ppf }, as an additive key the desktop app does not read and
  // therefore cannot be broken by. A sheet with no entry falls back to the
  // document scale, which is exactly what the desktop app would have used.
  //
  // What makes this safe in both directions is that the stored `value` on
  // every item is authoritative and is never recomputed on load. A project
  // round-tripping through the desktop app keeps its numbers even where that
  // app has no idea a sheet had its own scale.

  get documentPpf() {
    const v = Number(this.metadata.pixels_per_foot);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_PPF;
  }

  set documentPpf(ppf) {
    this.metadata.pixels_per_foot = ppf;
  }

  pagePpf(pageKey) {
    const scales = this.metadata.page_scales || {};
    const v = Number(scales[String(pageKey)]);
    if (Number.isFinite(v) && v > 0) return v;
    return this.documentPpf;
  }

  pageScaleLabel(pageKey) {
    return scaleLabelFor(this.pagePpf(pageKey), this.dpi);
  }

  /**
   * Restate one sheet's scale.
   *
   * Items already drawn KEEP their own stamped ppf — this only changes what
   * the next measurement will be drawn at. Re-valuing existing work is a
   * separate, explicit act; see restampPage.
   */
  setPageScale(pageKey, ppf) {
    this.transact('Set sheet scale', () => {
      this.metadata.page_scales = { ...(this.metadata.page_scales || {}) };
      this.metadata.page_scales[String(pageKey)] = ppf;
      // Keep the document scale following the sheet the user is working on.
      // The desktop app has only this one field, so leaving it behind would
      // make everything drawn there afterwards come out at the old scale.
      this.metadata.pixels_per_foot = ppf;
    });
    this.emit('scale-changed', { pageKey, ppf });
  }

  /**
   * Re-value every item on a sheet to a new scale. Destructive and explicit:
   * the caller must have confirmed it with the user, because the quantities
   * in a bid change underneath them.
   */
  restampPage(pageKey, ppf) {
    this.transact('Restate sheet scale', () => {
      this.metadata.page_scales = { ...(this.metadata.page_scales || {}) };
      this.metadata.page_scales[String(pageKey)] = ppf;
      this.metadata.pixels_per_foot = ppf;
      const label = scaleLabelFor(ppf, this.dpi);
      for (const it of this.itemsOn(pageKey)) {
        // Except the one type whose scale is deliberately NOT this sheet's.
        // A reference distance is a detail read at a scale picked for that
        // line alone; re-stamping one writes the sheet's scale onto it and
        // the chip then prints the exact lie the object exists to prevent.
        // It is also the only item here that keeps its own `scale` label, so
        // the two would disagree on the same line.
        if (KEEPS_OWN_SCALE.has(it.type)) continue;
        it.ppf = ppf;
        it.scale_label = label;
      }
    });
    this.emit('scale-changed', { pageKey, ppf, restamped: true });
  }

  // ── item access ─────────────────────────────────────────────────────

  itemsOn(pageKey) {
    return this.measurements[pageKey] || (this.measurements[pageKey] = []);
  }

  annotationsOn(pageKey) {
    return this.annotations[pageKey] || (this.annotations[pageKey] = []);
  }

  /** Every item in the job, as [pageKey, item] pairs, in page order. */
  *allItems() {
    for (const key of Object.keys(this.measurements).sort(comparePageKeys)) {
      for (const it of this.measurements[key]) yield [Number(key), it];
    }
  }

  /** Items that count toward the estimate: no rulers, notes or child shapes. */
  *takeoffItems() {
    for (const [key, it] of this.allItems()) {
      if (NON_TAKEOFF_TYPES.has(it.type)) continue;
      if (it.group_child) continue;
      yield [key, it];
    }
  }

  findItem(id) {
    for (const [key, it] of this.allItems()) if (it._uid === id) return { pageKey: key, item: it };
    return null;
  }

  /**
   * Add a markup annotation to a page.
   *
   * Annotations are NOT takeoff: no quantity, no unit, no scale stamp, and no
   * place in any report. They carry only what the desktop writes.
   */
  addAnnotation(pageKey, annot, { label = 'Markup' } = {}) {
    let created = null;
    this.transact(label, () => {
      created = { visible: true, ...annot, _uid: newId('a') };
      this.annotationsOn(pageKey).push(created);
    });
    this.emit('annotations-changed', { pageKey });
    return created;
  }

  /** Remove annotations by runtime id. */
  removeAnnotations(ids, { label = 'Erase' } = {}) {
    const set = new Set(ids);
    if (!set.size) return 0;
    let n = 0;
    this.transact(label, () => {
      for (const key of Object.keys(this.annotations)) {
        const before = this.annotations[key].length;
        this.annotations[key] = this.annotations[key].filter(a => !set.has(a._uid));
        n += before - this.annotations[key].length;
      }
    });
    this.emit('annotations-changed', {});
    return n;
  }

  /** Add an item to a page, stamping the fields every reader relies on. */
  addItem(pageKey, item, { label = 'Add item' } = {}) {
    let created = null;
    this.transact(label, () => {
      const list = this.itemsOn(pageKey);
      const ppf = Number(item.ppf) > 0 ? Number(item.ppf) : this.pagePpf(pageKey);
      created = {
        _uid: newId('m'),
        visible: true,
        sort_order: this._nextSortOrder(),
        ppf,
        scale_label: scaleLabelFor(ppf, this.dpi),
        ...item,
      };
      // A caller that passed ppf keeps it; one that did not gets the page's.
      created.ppf = ppf;
      created._uid = created._uid || newId('m');
      list.push(created);
    });
    this.emit('items-changed', { pageKey });
    return created;
  }

  updateItem(id, patch, { label = 'Edit item' } = {}) {
    const found = this.findItem(id);
    if (!found) return null;
    this.transact(label, () => Object.assign(found.item, patch));
    this.emit('items-changed', { pageKey: found.pageKey });
    return found.item;
  }

  removeItems(ids, { label = 'Delete' } = {}) {
    const set = new Set(ids);
    if (!set.size) return 0;
    let n = 0;
    this.transact(label, () => {
      for (const key of Object.keys(this.measurements)) {
        const before = this.measurements[key].length;
        // A group's children go with it — they exist only to draw its shape.
        // A group's children go with its master: they exist only to draw it.
        const masters = new Set(
          this.measurements[key].filter(it => set.has(it._uid) && it.group_id)
            .map(it => it.group_id)
        );
        this.measurements[key] = this.measurements[key].filter(
          it => !set.has(it._uid) && !(it.group_child && masters.has(it.group_id))
        );
        n += before - this.measurements[key].length;
      }
    });
    this.emit('items-changed', {});
    return n;
  }

  _nextSortOrder() {
    let max = 0;
    for (const [, it] of this.allItems()) max = Math.max(max, it.sort_order || 0);
    return max + 100;
  }

  // ── visibility and isolation ────────────────────────────────────────
  //
  // Isolation ("show only these") is a way of LOOKING, never a property of the
  // work. It must never reach the file: a save taken while isolated would
  // otherwise persist every other item as hidden, and the estimator would
  // reopen the job to a sheet that looks empty.

  /** Hide everything except these item ids, without touching stored state. */
  isolate(ids) {
    this._isolation = ids && ids.length ? new Set(ids) : null;
    this.emit('visibility-changed', {});
  }

  clearIsolation() {
    this._isolation = null;
    this.emit('visibility-changed', {});
  }

  get isolating() { return !!this._isolation; }

  /** What the canvas should draw right now. */
  isVisible(item) {
    if (this._isolation) return this._isolation.has(item._uid);
    return item.visible !== false;
  }

  /** The stores as they must be written — real visibility, never isolation. */
  measurementsWithBaselineVisibility() {
    return this.measurements;   // isolation was never written into the items
  }

  setVisible(ids, visible) {
    const set = new Set(ids);
    this.transact(visible ? 'Show items' : 'Hide items', () => {
      for (const [, it] of this.allItems()) if (set.has(it._uid)) it.visible = !!visible;
    });
    this.emit('visibility-changed', {});
  }

  // ── page structure ──────────────────────────────────────────────────

  /**
   * The sheet number as the app shows it: a user override first, then what
   * was detected off the drawing, then a plain page number.
   * This is the one place that order lives.
   */
  pageLabel(index) {
    const custom = this.metadata.page_labels_custom?.[String(index)];
    if (custom) return String(custom);
    const detected = this.metadata.page_labels?.[index];
    if (detected) return String(detected);
    return `Pag: ${index + 1}`;
  }

  /** The detected label alone, with no override applied. */
  detectedLabel(index) {
    return String(this.metadata.page_labels?.[index] || '');
  }

  /** The user's title for the sheet. */
  pageName(index) {
    return String(this.metadata.page_names?.[String(index)] || '');
  }

  /**
   * Rename a sheet. A label equal to what was detected clears the override
   * rather than storing a duplicate, so "reset to what the drawing says" is
   * just typing it back.
   */
  setPageLabel(index, label) {
    this.transact('Rename sheet', () => {
      const custom = { ...(this.metadata.page_labels_custom || {}) };
      const text = String(label || '').trim();
      if (!text || text === this.detectedLabel(index)) delete custom[String(index)];
      else custom[String(index)] = text;
      this.metadata.page_labels_custom = custom;
    });
    this.emit('pages-changed', {});
  }

  setPageName(index, name) {
    this.transact('Rename sheet', () => {
      const names = { ...(this.metadata.page_names || {}) };
      const text = String(name || '').trim();
      if (!text) delete names[String(index)];
      else names[String(index)] = text;
      this.metadata.page_names = names;
    });
    this.emit('pages-changed', {});
  }

  /**
   * Record that pages were inserted at `at`. Everything filed under a later
   * page number moves along with it; the standalone bucket does not move.
   *
   * A callout pin stores `ref_page`, the index of the sheet it points at —
   * a reference INTO the set, which the bucket shuffling does not touch.
   * remapPageIndices moves it with its sheet, and a pin whose target is
   * deleted keeps its place and points nowhere (-1), as on the desktop.
   */
  notePagesInserted(at, count) {
    const atEnd = at >= this.pageCount;
    this._shiftStores(at - 1, count);
    spliceArray(this.metadata.page_labels, at, count, '');
    // Every index-keyed dict has to move with the pages, or a sheet inserted
    // in the middle silently takes the name and scale of the one after it.
    for (const key of INDEX_DICT_KEYS) {
      this.metadata[key] = shiftIndexDict(this.metadata[key], at - 1, count);
    }
    // ...and every record the revision model files by sheet, and every index
    // stored INSIDE a record: a callout's target, an overlay's compared
    // sheet, a group's pages, the sheet a revision ADDED (sheet_origin).
    remapPageIndices(this.metadata, this.measurements, insertMapper(at, count),
      { reordered: !atEnd });
    this.pageCount += count;
    this.clearHistory('a sheet was added');
    this.markDirty();
    // `at` and `delta` are carried so anything keyed by page index OUTSIDE
    // this class can move with the sheets too — temporary dimensions are.
    this.emit('pages-changed', { at, delta: count });
  }

  /** Record that one page was removed. Its items go with it. */
  notePageRemoved(index) {
    const last = index >= this.pageCount - 1;
    // A multi-shape item whose MASTER is on this sheet lives on through its
    // runs on other sheets: one of them takes the item over first, exactly
    // as the desktop does (_promote_masters_leaving). Without it the runs
    // were left with no master, every reader skips a run, and the rest of
    // the item silently left the bid -- here and in the desktop on reopen.
    promoteMastersLeaving(this.measurements, index);
    delete this.measurements[index];
    delete this.annotations[index];
    this._shiftStores(index, -1);
    (this.metadata.page_labels || []).splice(index, 1);
    for (const key of INDEX_DICT_KEYS) {
      const d = { ...(this.metadata[key] || {}) };
      delete d[String(index)];
      this.metadata[key] = shiftIndexDict(d, index, -1);
    }
    remapPageIndices(this.metadata, this.measurements, deleteMapper(index),
      { reordered: !last });
    this.pageCount = Math.max(0, this.pageCount - 1);
    // What is left of each multi-shape item is added up again: a run that
    // went with the sheet is no longer in its item's total (_resync_groups).
    resyncGroups(this, { layout: true });
    this.clearHistory('a sheet was deleted');
    this.markDirty();
    this.emit('pages-changed', { at: index, delta: -1 });
  }

  /**
   * Drop the undo history.
   *
   * A snapshot holds the metadata and the two page-keyed stores, but NOT the
   * PageStore that owns the sheet images — that lives outside this class and
   * cannot be cloned, since its pages are slices of a 2 GB file. So an undo
   * taken across a sheet insert or delete would restore item buckets keyed for
   * a page list that no longer exists, and items would reappear on the wrong
   * drawings.
   *
   * Clearing is the honest answer. The alternative is an undo that looks like
   * it worked and quietly moved somebody's takeoff to another sheet.
   */
  clearHistory(reason = '') {
    if (!this._undo.length && !this._redo.length) return;
    this._undo.length = 0;
    this._redo.length = 0;
    this.emit('history-changed', { cleared: true, reason });
  }

  _shiftStores(after, delta) {
    for (const store of [this.measurements, this.annotations]) {
      const moved = {};
      for (const key of Object.keys(store)) {
        moved[shiftPageKey(Number(key), after, delta)] = store[key];
      }
      for (const key of Object.keys(store)) delete store[key];
      Object.assign(store, moved);
    }
  }

  // ── undo / redo ─────────────────────────────────────────────────────

  snapshot() {
    return {
      measurements: structuredClone(this.measurements),
      annotations: structuredClone(this.annotations),
      metadata: structuredClone(this.metadata),
      pageCount: this.pageCount,
    };
  }

  restore(snap) {
    this.measurements = structuredClone(snap.measurements);
    this.annotations = structuredClone(snap.annotations);
    this.metadata = structuredClone(snap.metadata);
    this.pageCount = snap.pageCount;
  }

  /**
   * Run `fn` as one undoable step.
   *
   * Nesting is allowed and collapses: an outer transaction owns the snapshot,
   * so a compound edit built from smaller ones lands on the undo stack once.
   */
  transact(label, fn) {
    if (this._txDepth === 0) this._txSnapshot = this.snapshot();
    this._txDepth += 1;
    try {
      return fn();
    } finally {
      this._txDepth -= 1;
      if (this._txDepth === 0) {
        this._undo.push({ label, state: this._txSnapshot });
        if (this._undo.length > UNDO_DEPTH) this._undo.shift();
        this._redo.length = 0;
        this._txSnapshot = null;
        this.markDirty();
        this.emit('history-changed', {});
      }
    }
  }

  /**
   * Push a step whose "before" state was captured earlier — a drag, where the
   * snapshot has to be taken on pointerdown but is only worth keeping if the
   * pointer actually moved something.
   *
   * Goes through the same depth cap as transact(). Pushing straight onto
   * _undo bypassed it, and a long editing session grew the stack without
   * bound, every entry a full clone of the project.
   */
  pushUndo(label, state) {
    this._undo.push({ label, state });
    if (this._undo.length > UNDO_DEPTH) this._undo.shift();
    this._redo.length = 0;
    this.markDirty();
    this.emit('history-changed', {});
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get undoLabel() { return this._undo[this._undo.length - 1]?.label || ''; }
  get redoLabel() { return this._redo[this._redo.length - 1]?.label || ''; }

  undo() {
    const step = this._undo.pop();
    if (!step) return false;
    this._redo.push({ label: step.label, state: this.snapshot(), booking: step.booking });
    this._restoreKeepingBook(step, 'undo');
    this.markDirty();
    this.emit('history-changed', {});
    this.emit('items-changed', {});
    this.emit('pages-changed', {});
    return true;
  }

  redo() {
    const step = this._redo.pop();
    if (!step) return false;
    this._undo.push({ label: step.label, state: this.snapshot(), booking: step.booking });
    this._restoreKeepingBook(step, 'redo');
    this.markDirty();
    this.emit('history-changed', {});
    this.emit('items-changed', {});
    this.emit('pages-changed', {});
    return true;
  }

  // ── which drawing counts, across an undo ────────────────────────────
  //
  // A snapshot here holds the whole metadata, and the book
  // (metadata.sheet_version) is in it. Restored wholesale, an undo of ANY
  // older edit would put back the book as it stood then — taking back a
  // "Count this version" he clicked since, a number moving with nothing on
  // screen asking for it. The desktop keeps the book out of the history for
  // exactly that reason, and so does this: every undo and redo carries the
  // book as it stands.
  //
  // The one exception is a booking a TAKEOFF caused — the first takeoff on
  // an empty sheet, or his Yes to counting the drawing his takeoff just
  // landed on. That exists because of the takeoff, so it rides the takeoff's
  // undo level (`step.booking`): Ctrl+Z takes it back, Ctrl+Y makes it
  // again — but only while it is still that booking, never one he changed
  // since (desktop _undo_booking). Whatever moved is SAID: the 'booking'
  // event carries what the totals were counted under before.

  /** The book as it stands, and each revision's booked_over, to carry. */
  _bookNow() {
    return {
      book: this.metadata.sheet_version ? structuredClone(this.metadata.sheet_version) : null,
      over: new Map((this.metadata.revisions || [])
        .map(r => [String(r.id), r.booked_over ? structuredClone(r.booked_over) : null])),
    };
  }

  _restoreKeepingBook(step, direction) {
    const kept = this._bookNow();
    // The job as it stood BEFORE this step: what the step's sentence is
    // measured from. Read after the restore, the totals were already the
    // picture's, and Ctrl+Z of a Yes named only what came back.
    const prior = { metadata: this.metadata, measurements: this.measurements,
      pageCount: this.pageCount };
    this.restore(step.state);
    if (kept.book && Object.keys(kept.book).length) this.metadata.sheet_version = kept.book;
    else delete this.metadata.sheet_version;
    for (const r of this.metadata.revisions || []) {
      const o = kept.over.get(String(r.id));
      if (o) r.booked_over = o;
      else if (kept.over.has(String(r.id))) delete r.booked_over;
    }
    const tag = step.booking;
    if (!tag) return;
    const page = tag.page;
    const [frm, to] = direction === 'undo' ? [tag.now, tag.was] : [tag.was, tag.now];
    const book = { ...(this.metadata.sheet_version || {}) };
    if (String(book[String(page)] || '') !== frm) return;
    // The takeoff on the sheet must be exactly what it was on that side of
    // the takeoff: anything he did in between is his, and wins.
    const fp = takeoffFingerprint(this.measurements[page] || []);
    if (tag.kind === 'asked') {
      const want = direction === 'undo' ? tag.fpBefore : tag.fpAfter;
      if (JSON.stringify(sortedObj(fp)) !== JSON.stringify(sortedObj(want || {}))) return;
    } else {
      const rids = Object.keys(fp);
      const ok = direction === 'undo' ? rids.length === 0
        : (rids.length === 1 && rids[0] === to);
      if (!ok) return;
    }
    const before = this.metadata.sheet_version ? { ...this.metadata.sheet_version } : null;
    if (to) book[String(page)] = to;
    else delete book[String(page)];
    if (Object.keys(book).length) this.metadata.sheet_version = book;
    else delete this.metadata.sheet_version;
    this.emit('booking', { page, direction, kind: tag.kind || 'first', to, bookBefore: before,
      prior });
  }

  /**
   * Hang a booking on the newest undo level — the takeoff that caused it —
   * when that level is still `level`. False when the history has moved past
   * it: the booking is then his own, like a click on Count this version.
   */
  tagBooking(level, tag) {
    if (!level || this._undo[this._undo.length - 1] !== level) return false;
    level.booking = tag;
    return true;
  }

  /** The newest undo level, to hand back to tagBooking. */
  get undoTop() { return this._undo[this._undo.length - 1] || null; }

  // ── dirty state ─────────────────────────────────────────────────────

  get dirty() { return this._dirty; }

  markDirty() {
    if (!this._dirty) {
      this._dirty = true;
      this.emit('dirty-changed', { dirty: true });
    }
  }

  markSaved() {
    this._dirty = false;
    this.emit('dirty-changed', { dirty: false });
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function nowStamp() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()} ${String(h).padStart(2, '0')}:${mi} ${ampm}`;
}

function defaultLayers() {
  return [
    { name: '0', color: '#ffffff', visible: true, locked: false },
  ];
}

function normaliseStore(store) {
  const out = {};
  for (const [k, v] of Object.entries(intKeyed(store))) {
    out[k] = Array.isArray(v) ? v : [];
  }
  return out;
}

/**
 * Older files carried one scale for the whole document. Spread it across the
 * sheets rather than losing it — a document-wide scale is still what every
 * sheet in that file was measured at.
 */
function normaliseScales(pageScales) {
  const out = {};
  for (const [k, v] of Object.entries(pageScales || {})) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[String(k)] = n;
  }
  return out;
}

/**
 * Pair each saved revision record with the sheet count of its image set.
 *
 * The file stores the two separately and pairs them BY POSITION: the nth
 * `metadata.revisions` record describes the nth set of blobs in the TKREVS01
 * tail. Verified across the library — every project's blob counts match its
 * records' `page_labels` lengths exactly, set for set.
 *
 * A record whose images are not in this file gets `pageCount: 0`. It is kept
 * rather than dropped: the id is still real, every item ever taken off that
 * revision is stamped with it, and minting a fresh id on a re-import would
 * strand them for good. It simply has no pages to show.
 *
 * A set of blobs with no record is the other way round — it has pages and no
 * description. It is given a placeholder so the sheets can still be looked at,
 * flagged `_orphanSet` so the save strips it back out and the file keeps
 * exactly the `revisions` array it arrived with.
 */
function adoptRevisions(saved, counts) {
  const list = Array.isArray(saved) ? saved : [];
  const out = [];
  for (let i = 0; i < Math.max(list.length, counts.length); i++) {
    const rec = list[i];
    const n = Number.isFinite(counts[i]) ? counts[i] : 0;
    if (rec) {
      out.push({
        ...rec,
        // Which set of blobs in the tail is this record's. It is just `i` —
        // the file pairs them by position and nothing else — but everything
        // downstream reads a FILTERED list (visible, non-empty), where the
        // array position no longer means the set number. Carrying it avoids
        // every bug of the form "column 3 fetched revision 4's pixels".
        _setIndex: i,
        id: String(rec.id || ''),
        match: revIndexMap(rec.match),
        extra: revSlotMap(rec.extra),
        page_labels: Array.isArray(rec.page_labels) ? rec.page_labels.slice() : [],
        visible: rec.visible !== false,
        archived: !!rec.archived,
        pageCount: n,
      });
    } else {
      out.push({
        _setIndex: i,
        id: `rev-unnamed-${i}`, date: '', description: `Revision ${i + 1}`,
        notes: '', source: '', added: '', visible: true, archived: false,
        page_labels: [], match: {}, extra: {}, pageCount: n, _orphanSet: true,
      });
    }
  }
  return out;
}

/** A revision's match map: {mainPageIndex: revPageIndex}, both real indices. */
function revIndexMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    const i = parseInt(k, 10);
    const j = Number(v);
    if (Number.isFinite(i) && Number.isInteger(j) && j >= 0) out[String(i)] = j;
  }
  return out;
}

/** A revision's extra map: {slotId: revPageIndex}. The key is NOT an index. */
function revSlotMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    const j = Number(v);
    if (k && Number.isInteger(j) && j >= 0) out[String(k)] = j;
  }
  return out;
}

/**
 * Revision fields this app adds at runtime and the file must never carry.
 *
 * `pageCount` is read back from the tail on every open, and `_orphanSet`
 * describes a record that does not exist on disk at all. Writing either would
 * change a file the round-trip test proves byte-identical.
 */
const REVISION_RUNTIME_KEYS = ['pageCount', '_orphanSet', '_setIndex'];

/** The `revisions` array as the file wants it: no runtime keys, no orphans. */
function revisionsForSave(revs) {
  return (revs || []).filter(r => !r._orphanSet).map(r => {
    const copy = { ...r };
    for (const key of REVISION_RUNTIME_KEYS) delete copy[key];
    return copy;
  });
}

/**
 * The metadata dicts keyed by a stringified page index.
 *
 * NOT page_groups: the desktop's page_groups is a LIST of {id, name,
 * pages: [...]}, and shifting it as a dict turned that list into an object
 * the desktop then iterates as strings. remapPageIndices moves it, the
 * desktop's way.
 */
const INDEX_DICT_KEYS = ['page_labels_custom', 'page_names', 'page_scales'];

/** {revId: pieces of takeoff} on one sheet — what an undo must find again. */
export function takeoffFingerprint(items) {
  const out = {};
  for (const m of items || []) {
    if (!isTakeoffType(m)) continue;
    const r = itemRevId(m);
    out[r] = (out[r] || 0) + 1;
  }
  return out;
}

function sortedObj(o) {
  return Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ── multi-shape items across a page delete (desktop GLPageWidget) ────────

const PROMOTE_KEYS = ['name', 'label', 'notes', 'floor_level', 'category', 'layer',
  'sub_category', 'cost_type', 'sort_order', 'associated_items', 'color', 'visible',
  'pitch', 'purpose', 'catalog_code', 'catalog_unit', 'framing', 'framing_suppressed'];

/** desktop _promote_child: a run takes over the item from its master. */
function promoteChild(doomed, heir) {
  for (const k of PROMOTE_KEYS) if (k in doomed) heir[k] = doomed[k];
  delete heir.group_child;
  heir.own_value = heir.value ?? 0;
  if ('perimeter' in heir) heir.own_perimeter = heir.perimeter;
  if ('flat_area' in heir) heir.own_flat = heir.flat_area;
  if ('total_ft' in heir) heir.own_total_ft = heir.total_ft;
}

function pageKeysSorted(meas) {
  return Object.keys(meas).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
}

/** desktop _promote_masters_leaving: before `page` is dropped. */
export function promoteMastersLeaving(meas, page) {
  for (const m of [...(meas[page] || [])]) {
    const gid = m.group_id;
    if (!gid || m.group_child) continue;
    const heirs = [];
    for (const pg of pageKeysSorted(meas)) {
      if (pg === page) continue;
      for (const s of meas[pg] || []) {
        if (s.group_id === gid && s.group_child) heirs.push(s);
      }
    }
    if (heirs.length) promoteChild(m, heirs[0]);
  }
}

/**
 * Every multi-shape master re-adds its shapes — only the runs on drawings
 * their sheets count from, as the desktop's _sync_group does.
 *
 * `layout: true` is the desktop's _resync_groups, after a page came or went:
 * a group left with no master also promotes its first shape, and a lone
 * master's own numbers become its numbers. `layout: false` is its
 * _resync_group_totals, after the book moved: the masters' totals only.
 */
export function resyncGroups(project, { layout = false } = {}) {
  const meas = project.measurements;
  const seen = new Set();
  const all = [];
  for (const pg of pageKeysSorted(meas)) for (const m of meas[pg] || []) all.push([pg, m]);
  if (layout) {
    for (const [, m] of all) {
      const gid = m.group_id;
      if (gid && m.group_child && !seen.has(gid)) {
        seen.add(gid);
        if (!all.some(([, x]) => x.group_id === gid && !x.group_child)) promoteChild({}, m);
      }
    }
  }
  // Which runs are ADDED UP is the counting rule's (desktop _shape_counts ->
  // run_counts_towards): a run on a drawing its sheet does not count from is
  // drawn and numbered, and is in no total.
  const model = new CountingModel({ metadata: project.metadata,
    measurements: meas, pageCount: project.pageCount });
  const counts = (p, x) => model.runCountsTowards(p, x);
  const get = (o, k, dflt) => (k in o ? o[k] : dflt);
  for (const [pg, m] of all) {
    if (m.group_child) continue;
    if (!m.group_id && !('own_value' in m)) continue;
    if (!m.group_id) {
      if (!layout) continue;
      for (const [k, own] of [['value', 'own_value'], ['perimeter', 'own_perimeter'],
        ['flat_area', 'own_flat'], ['total_ft', 'own_total_ft']]) {
        if (own in m) m[k] = m[own];
      }
      m.group_count = 1;
      continue;
    }
    const shapes = all.filter(([, x]) => x.group_id === m.group_id)
      .sort((a, b) => (!!a[1].group_child - !!b[1].group_child) || (a[0] - b[0]));
    const children = shapes.filter(([, x]) => x.group_child);
    const adding = children.filter(([p, x]) => counts(p, x)).map(([, x]) => x);
    const mine = counts(pg, m);
    const sum = (key, ownKey) => {
      const own = mine ? (Number(get(m, ownKey, get(m, key, 0)) || 0) || 0) : 0;
      return own + adding.reduce((s, c) => s + (Number(get(c, key, 0) || 0) || 0), 0);
    };
    m.value = sum('value', 'own_value');
    m.group_count = 1 + children.length;
    m.shape_no = 1;
    children.forEach(([, c], i) => { c.shape_no = i + 2; c.group_count = m.group_count; });
    if (m.type === 'area' || m.type === 'slope_area') m.perimeter = sum('perimeter', 'own_perimeter');
    if (m.type === 'slope_area') m.flat_area = sum('flat_area', 'own_flat');
    if (m.type === 'linear_count') m.total_ft = sum('total_ft', 'own_total_ft');
  }
}

/** Anything keyed by page index, normalised to a dict of string keys. */
function indexDict(v) {
  const out = {};
  if (Array.isArray(v)) {
    // A list written by an older build of THIS app. Carry the values over
    // rather than dropping the user's sheet names on the floor.
    v.forEach((val, i) => { if (val) out[String(i)] = val; });
    return out;
  }
  for (const [k, val] of Object.entries(v || {})) {
    if (val !== '' && val != null) out[String(k)] = val;
  }
  return out;
}

/** Move an index-keyed dict along when pages are inserted or removed. */
function shiftIndexDict(dict, after, delta) {
  const out = {};
  for (const [k, v] of Object.entries(dict || {})) {
    const n = Number(k);
    if (!Number.isFinite(n)) { out[k] = v; continue; }
    out[String(shiftPageKey(n, after, delta))] = v;
  }
  return out;
}

function spliceArray(arr, at, count, fill) {
  if (!Array.isArray(arr)) return;
  arr.splice(at, 0, ...new Array(count).fill(fill));
}

// ── scale recovery ────────────────────────────────────────────────────────

/** Types whose stored value is a real-world measurement, so scale matters. */
const MEASURED_TYPES = new Set([
  'area', 'slope_area', 'grid', 'tile', 'distance', 'polyline', 'linear_count',
  // The one type whose scale is deliberately NOT the sheet's. When its own
  // cannot be recovered there is nothing left to fall back on that is even
  // approximately right, so it belongs here before any other type does.
  'ref_distance',
]);

// A recovered ppf outside this band is arithmetic noise from a degenerate
// shape, not a drawing scale. Fall back rather than trust it.
const PPF_MIN = 0.5;
const PPF_MAX = 1500;

/**
 * The pixels-per-foot an item was drawn at, inverted from its own geometry and
 * its stored value. Returns null when the item carries nothing to invert.
 */
export function recoverPpf(item) {
  const pts = item.points || [];
  // A multi-shape master's `value` is the total over EVERY shape, while its
  // points are only its own. Dividing one shape's pixels by three shapes' feet
  // recovers a scale wrong by roughly the shape count — and it lands inside
  // the guard band, so it is accepted as recovered rather than flagged.
  const own = shapeOwn(item);
  const value = own.value;
  if (!(value > 0)) return null;

  let ppf = null;
  switch (item.type) {
    case 'area':
    case 'grid':
    case 'tile': {
      if (pts.length < 3) return null;
      const px2 = polygonArea(pts);
      if (!(px2 > 0)) return null;
      ppf = Math.sqrt(px2 / value);
      break;
    }
    case 'slope_area': {
      // The value is the SLOPED area; the flat one is what the pixels measure.
      const flat = own.flat;
      if (pts.length < 3 || !(flat > 0)) return null;
      const px2 = polygonArea(pts);
      if (!(px2 > 0)) return null;
      ppf = Math.sqrt(px2 / flat);
      break;
    }
    case 'distance':
    case 'polyline':
    // The reference distance inverts exactly like a plain one — two points
    // in pixels, one length in feet — and it is the ONE type that cannot
    // fall back to the page when the inversion is missing, because the whole
    // object exists to say it was not measured at the page's scale.
    case 'ref_distance': {
      if (pts.length < 2) return null;
      const px = pathLength(pts);
      if (!(px > 0)) return null;
      ppf = px / value;
      break;
    }
    case 'linear_count': {
      // A count cannot be inverted, but the run it was counted along can.
      const ft = own.totalFt;
      if (pts.length < 2 || !(ft > 0)) return null;
      const px = pathLength(pts);
      if (!(px > 0)) return null;
      ppf = px / ft;
      break;
    }
    default:
      return null;
  }

  if (!Number.isFinite(ppf) || ppf < PPF_MIN || ppf > PPF_MAX) return null;
  return ppf;
}

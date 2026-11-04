// scratch.js — temporary dimensions.
//
// A measurement you take to READ a drawing is not takeoff. You want to know
// how wide a room is, whether a beam clears an opening, what a roof pitch is —
// and then you want it gone. It is not a quantity, it does not belong to a
// trade, it has no cost, and it must never turn up in an estimate.
//
// So it never enters the project. This store sits beside it and is not part of
// anything a save reads: `buildSaveMetadata` composes the file out of
// `project.measurements` and `project.annotations`, and a scratch item is in
// neither. That is the whole guarantee, and it is worth saying why it is built
// this way round — the alternative is a `temporary: true` flag on a real item,
// which works only for as long as every writer, every export and every future
// feature remembers to filter on it. One that forgets prices a ruler.
//
// Cleared when the project closes, and clearable by hand. Kept per sheet, so
// walking a set and coming back finds your dimensions where you left them.

/** Items on a page carry a runtime id so the renderer and the list can key on them. */
let counter = 0;

export class ScratchStore extends EventTarget {
  constructor() {
    super();
    /** @type {Map<number, object[]>} page index -> temporary items */
    this._byPage = new Map();
  }

  /** The temporary items on one sheet. Never null; never a copy to mutate. */
  forPage(page) {
    return this._byPage.get(page) || EMPTY;
  }

  /** How many there are altogether, across every sheet. */
  get count() {
    let n = 0;
    for (const list of this._byPage.values()) n += list.length;
    return n;
  }

  /** The sheets that have any, in page order. */
  pages() {
    return [...this._byPage.keys()].filter(k => (this._byPage.get(k) || []).length)
      .sort((a, b) => a - b);
  }

  add(page, item) {
    counter += 1;
    const m = { ...item, scratch: true, _uid: `scratch-${counter}`, visible: true };
    const list = this._byPage.get(page);
    if (list) list.push(m);
    else this._byPage.set(page, [m]);
    this.emit();
    return m;
  }

  /** Drop the most recent one on a sheet — the undo a scratch pad needs. */
  undo(page) {
    const list = this._byPage.get(page);
    if (!list || !list.length) return false;
    list.pop();
    if (!list.length) this._byPage.delete(page);
    this.emit();
    return true;
  }

  remove(uid) {
    for (const [page, list] of this._byPage) {
      const i = list.findIndex(m => m._uid === uid);
      if (i < 0) continue;
      list.splice(i, 1);
      if (!list.length) this._byPage.delete(page);
      this.emit();
      return true;
    }
    return false;
  }

  /** Clear one sheet, or the whole project when `page` is omitted. */
  clear(page = null) {
    if (page === null) {
      if (!this._byPage.size) return false;
      this._byPage.clear();
    } else {
      if (!this._byPage.has(page)) return false;
      this._byPage.delete(page);
    }
    this.emit();
    return true;
  }

  /**
   * Move the temporary items with the sheets.
   *
   * They are keyed by page index like everything else, so an inserted or
   * deleted sheet moves them. Getting this wrong would draw a dimension over
   * a drawing it was not taken from — the same failure the revision model
   * guards against, and just as quiet.
   */
  shiftPages(at, delta) {
    if (!this._byPage.size) return;
    const next = new Map();
    for (const [page, list] of this._byPage) {
      if (delta < 0 && page === at) continue;       // that sheet is gone
      next.set(page >= at ? page + delta : page, list);
    }
    this._byPage = next;
    this.emit();
  }

  emit() {
    this.dispatchEvent(new CustomEvent('changed'));
  }
}

const EMPTY = Object.freeze([]);

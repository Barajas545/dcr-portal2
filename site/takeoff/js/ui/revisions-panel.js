// revisions-panel.js — every version of every sheet, in one place.
//
// Three ways of asking the same question, because estimators ask it three ways:
//
//   SETS      "what did the architect send, and when?"
//   MATRIX    "which sheets did this revision reissue?"  — the grid: original
//             sheets down the side, one column per revision set
//   CURRENT   "which drawing do I build from?" — one page per sheet number,
//             newest version only, by the same rule the desktop app uses
//
// WHY THERE ARE NO THUMBNAILS IN THE GRID. On the estimator's largest job the
// matrix is 214 rows by 12 columns — 2,568 cells. Each cell's picture is a
// 6300×4500 sheet inside a 1.42 GB tail, so drawing them all would be 2,568
// decodes of ~100 ms. The grid is therefore text and state; a picture appears
// when a cell is actually chosen, which fetches exactly one sheet.
//
// The panel is NOT modal. Clicking a cell flips the drawing behind it, and
// that back-and-forth is the whole point — a backdrop would break it.

import {
  visibleRevisions, sheetVersions, newestVersionOf, resolveLatestSheets,
  revPageCount, revPageLabel, revName, rowPlan, parseRevisionDate,
  revisionRank, compareRank, ORIGINAL_RANK, revisionNamesOf, revisionNumber,
  originMapOf, originPair,
} from '../core/revisions.js';

/**
 * A revision's column head: its one name when that is short ("ASI 2"), else
 * R and its number — the same short form the Pages tiles use, so a sheet
 * marked R2 there is found under R2 here.
 */
function colHead(rev, all, names) {
  const nm = names[String(rev.id)] || '';
  const no = revisionNumber(rev.id, all);
  return (nm && [...nm].length <= 5 && !nm.startsWith('REV ')) ? nm : (no ? `R${no}` : 'R?');
}

/**
 * The rev_id of the newest version filling an inserted "new sheet" row.
 *
 * Same rank as everywhere else. A slot has no original to fall back on, so
 * '' here means "nothing fills this row" rather than "the sheet's own".
 */
function newestForSlot(slot, revs, order) {
  let best = '';
  let bestRank = ORIGINAL_RANK;
  revs.forEach((rev, c) => {
    const rp = (rev.extra || {})[slot.id];
    if (rp === undefined || rp === null || !(rp >= 0 && rp < revPageCount(rev))) return;
    const rank = revisionRank(rev, c, order);
    if (compareRank(rank, bestRank) > 0) { best = String(rev.id); bestRank = rank; }
  });
  return best;
}

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export class RevisionsPanel {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root
   * @param {() => object} o.state  { revs, page, viewingRevId, pageCount, order }
   * @param {object} o.host  { pageLabel, showVersion, showOwn, showLoosePage,
   *                           setOrder, exportCurrentSet }
   */
  constructor({ root, state, host }) {
    this.root = root;
    this.state = state;
    this.host = host;
    this.tab = 'matrix';
    this._built = false;
  }

  get open() { return !this.root.hidden; }

  show(tab) {
    if (tab) this.tab = tab;
    this.root.hidden = false;
    this.refresh();
  }

  hide() { this.root.hidden = true; }

  toggle(tab) { this.open && (!tab || tab === this.tab) ? this.hide() : this.show(tab); }

  /** Re-read everything. Cheap — no pixels are touched. */
  refresh() {
    if (this.root.hidden) return;
    const s = this.state();
    const revs = visibleRevisions(s.revs || []);

    if (!this._built) this._build();
    for (const b of this.root.querySelectorAll('.rp-tab')) {
      b.classList.toggle('on', b.dataset.tab === this.tab);
    }

    const body = this.root.querySelector('.rp-body');
    body.textContent = '';
    if (!revs.length) {
      body.appendChild(this._empty());
      return;
    }
    // One name per revision, numbered among ALL of them (hidden included),
    // and the sheets a revision ADDED (sheet_origin): read once per paint.
    s.names = revisionNamesOf(s.revs || []);
    s.originMap = originMapOf(s.origins || {}, s.revs || []);
    if (this.tab === 'sets') body.appendChild(this._sets(s, revs));
    else if (this.tab === 'current') body.appendChild(this._current(s, revs));
    else body.appendChild(this._matrix(s, revs));
  }

  _build() {
    this._built = true;
    this.root.textContent = '';

    const head = el('div', 'rp-head');
    head.appendChild(el('span', 'rp-title', 'PLAN REVISIONS'));
    const tabs = el('div', 'rp-tabs');
    for (const [id, label, title] of [
      ['matrix', 'Matrix', 'Every sheet against every revision set'],
      ['sets', 'Sets', 'What was issued, and when'],
      ['current', 'Current set', 'The newest version of every sheet number'],
    ]) {
      const b = el('button', 'rp-tab', label);
      b.dataset.tab = id;
      b.title = title;
      b.addEventListener('click', () => { this.tab = id; this.refresh(); });
      tabs.appendChild(b);
    }
    head.appendChild(tabs);
    const close = el('button', 'icon-btn', '✕');
    close.title = 'Close (Esc)';
    close.addEventListener('click', () => this.hide());
    head.appendChild(close);
    this.root.appendChild(head);
    this.root.appendChild(el('div', 'rp-body'));
  }

  _empty() {
    const d = el('div', 'rp-empty');
    d.appendChild(el('p', null,
      'This project has no plan revisions.'));
    d.appendChild(el('p', 'hint',
      'A revision set is a re-issue of part of the drawing set. When one is '
      + 'added, every sheet it reissues appears here beside the original, so '
      + 'you can flip between them and see what changed.'));
    return d;
  }

  // ── sets ───────────────────────────────────────────────────────────────

  _sets(s, revs) {
    const wrap = el('div', 'rp-sets');
    revs.forEach((rev, c) => {
      const card = el('div', 'rp-set');
      const h = el('div', 'rp-set-head');
      h.appendChild(el('span', 'rp-col', colHead(rev, s.revs, s.names)));
      h.appendChild(el('span', 'rp-set-name', revName(rev, c, s.names)));
      const date = (rev.date || '').trim();
      const d = el('span', 'rp-set-date', date || 'no date');
      if (!parseRevisionDate(date)) {
        d.classList.add('bad');
        d.title = 'This date cannot be read, so this revision is ranked '
          + 'OLDEST — it will never be chosen as the current drawing by date. '
          + 'Fix it in the desktop app, or rank by column order instead.';
      }
      h.appendChild(d);
      card.appendChild(h);

      const n = revPageCount(rev);
      const matched = Object.keys(rev.match || {}).length;
      const slots = Object.keys(rev.extra || {}).length;
      // The pages this revision ADDED to the set are project sheets now: not
      // loose, and not to be "paired in the desktop app".
      const addedHere = new Map();       // revPage -> the sheet it became
      for (const [k, o] of Object.entries(s.originMap || {})) {
        if (o[0] === String(rev.id) && o[1] >= 0 && o[1] < n
            && !Object.values(rev.match || {}).includes(o[1])
            && !Object.values(rev.extra || {}).includes(o[1])) {
          addedHere.set(o[1], parseInt(k, 10));
        }
      }
      const loose = Math.max(0, n - matched - slots - addedHere.size);
      const line = el('div', 'rp-set-stats');
      line.appendChild(el('span', null, `${n} sheet${n === 1 ? '' : 's'}`));
      line.appendChild(el('span', null, `${matched} matched`));
      if (slots) line.appendChild(el('span', null, `${slots} new`));
      if (addedHere.size) {
        const a = el('span', 'added', `◆ ${addedHere.size} added`);
        a.title = 'Sheets this revision added to the project — they are in the '
          + 'Pages list now, marked ADDED.';
        line.appendChild(a);
      }
      if (loose) {
        const w = el('span', 'warn', `${loose} unmatched`);
        w.title = 'These pages are not paired with any sheet in the project. '
          + 'They still count as sheets the architect issued, so the Current '
          + 'Set lists them — pair them in the desktop app to take off on them.';
        line.appendChild(w);
      }
      card.appendChild(line);

      if ((rev.notes || '').trim()) card.appendChild(el('div', 'rp-set-notes', rev.notes.trim()));
      if ((rev.source || '').trim()) {
        const src = el('div', 'rp-set-src', rev.source.trim());
        src.title = rev.source;
        card.appendChild(src);
      }
      if ((rev.added || '').trim()) {
        card.appendChild(el('div', 'rp-set-added', `added ${rev.added}`));
      }

      // Its sheets, as chips. One click puts that page on screen.
      //
      // A page is in exactly one of three states, and they are NOT the same
      // thing: paired with an original sheet, filling a row for a sheet that
      // did not exist in the original set, or paired with nothing at all.
      // Only the third opens on its own.
      const chips = el('div', 'rp-chips');
      const backToMain = new Map();      // revPage -> main sheet index
      for (const [k, rp] of Object.entries(rev.match || {})) backToMain.set(rp, parseInt(k, 10));
      const backToSlot = new Map();      // revPage -> the new-sheet row it fills
      const slotById = new Map((s.extraSheets || []).map(x => [x.id, x]));
      for (const [id, rp] of Object.entries(rev.extra || {})) backToSlot.set(rp, slotById.get(id));
      for (let rp = 0; rp < n; rp++) {
        const lbl = revPageLabel(rev, rp) || `p.${rp + 1}`;
        const b = el('button', 'rp-chip', lbl);
        const main = backToMain.get(rp);
        if (addedHere.has(rp)) {
          const at = addedHere.get(rp);
          b.classList.add('added');
          b.textContent = `◆ ${lbl}`;
          b.title = `Added to the project as sheet ${this.host.pageLabel(at)} — `
            + 'not part of the original plans. Opens that sheet.';
          b.addEventListener('click', () => this.host.showOwn(at));
        } else if (main !== undefined) {
          b.title = `Sheet ${this.host.pageLabel(main)}, as reissued by this revision`;
          b.addEventListener('click', () => this.host.showVersion(main, String(rev.id)));
        } else if (backToSlot.has(rp)) {
          const slot = backToSlot.get(rp);
          b.classList.add('slot');
          b.title = `${(slot && slot.label) || 'A new sheet'} — not in the original `
            + 'set, so this revision is where it comes from. Opens on its own.';
          b.addEventListener('click', () => this.host.showLoosePage(rev, rp));
        } else {
          b.classList.add('loose');
          b.title = 'Not paired with any sheet in this project — opens on its own. '
            + 'Pair it in the desktop app to take off on it.';
          b.addEventListener('click', () => this.host.showLoosePage(rev, rp));
        }
        chips.appendChild(b);
      }
      card.appendChild(chips);
      wrap.appendChild(card);
    });
    return wrap;
  }

  // ── the matrix ─────────────────────────────────────────────────────────

  _matrix(s, revs) {
    const wrap = el('div', 'rp-matrix');
    const table = el('div', 'rp-grid');
    table.style.setProperty('--rp-cols', String(revs.length + 1));

    // header
    const head = el('div', 'rp-row rp-row-head');
    head.appendChild(el('div', 'rp-cell rp-sheet', 'SHEET'));
    const orig = el('div', 'rp-cell rp-h', 'ORIG');
    orig.title = 'The drawing set this project was made from';
    head.appendChild(orig);
    revs.forEach((rev, c) => {
      const h = el('div', 'rp-cell rp-h', colHead(rev, s.revs, s.names));
      h.title = `${revName(rev, c, s.names)}${rev.date ? ` — ${rev.date}` : ''}`
        + `\n${revPageCount(rev)} sheets`;
      head.appendChild(h);
    });
    table.appendChild(head);

    const viewing = String(s.viewingRevId || '');
    const order = s.order || 'date';
    const mainLabels = Array.from({ length: s.pageCount },
      (_, i) => this.host.pageLabel(i));

    for (const step of rowPlan(mainLabels, s.extraSheets || [], revs)) {
      const row = el('div', 'rp-row');
      const isMain = step.kind === 'main';
      const i = step.index;

      const name = el('div', 'rp-cell rp-sheet');
      const org = isMain ? (s.originMap || {})[String(i)] : null;
      if (isMain) {
        name.appendChild(el('span', 'rp-no', `${org ? '◆ ' : ''}${mainLabels[i] || `${i + 1}`}`));
        name.appendChild(el('span', 'rp-seq', `${i + 1}`));
        if (org) {
          name.classList.add('added');
          name.title = 'ADDED — not part of the original plans. It came with '
            + `${(s.names || {})[org[0]] || 'a revision since deleted'}, as page ${org[1] + 1} of that set.`;
        }
        if (i === s.page) row.classList.add('here');
      } else {
        name.classList.add('slot');
        name.appendChild(el('span', 'rp-no', step.slot.label || 'NEW'));
        name.title = 'A sheet that exists only in a revision — it was not in '
          + 'the original set.';
      }
      row.appendChild(name);

      // Which version of this row is the current drawing. A "new sheet" row
      // has no original to fall back on, so its newest is worked out from the
      // revisions that fill it — by the same rank, or the matrix and the
      // Current Set would disagree about the same row.
      const newest = isMain
        ? newestVersionOf(i, s.revs, order, s.origins)
        : newestForSlot(step.slot, revs, order);
      const opair = isMain ? originPair(i, s.origins) : null;

      // column 0 — the original
      const c0 = el('div', 'rp-cell rp-v');
      if (isMain) {
        c0.classList.add('has');
        c0.textContent = '●';
        c0.title = `Sheet ${mainLabels[i] || i + 1} — this project's own drawing`;
        if (i === s.page && !viewing) c0.classList.add('on');
        if (!newest) c0.classList.add('newest');
        c0.addEventListener('click', () => this.host.showOwn(i));
      } else {
        c0.classList.add('none');
        c0.title = 'Not in the original set';
      }
      row.appendChild(c0);

      revs.forEach((rev, c) => {
        const cell = el('div', 'rp-cell rp-v');
        const rp = isMain
          ? (rev.match || {})[String(i)]
          : (rev.extra || {})[step.slot.id];
        const ok = rp !== undefined && rp !== null && rp >= 0 && rp < revPageCount(rev);
        const isOrigin = !!opair && String(rev.id) === opair[0];
        if (isOrigin && (!ok || rp === opair[1])
            && opair[1] >= 0 && opair[1] < revPageCount(rev)) {
          // The revision this sheet CAME WITH: its page is the sheet's own
          // drawing, not another version of it — shown as where the sheet
          // came from, and a click opens the sheet itself.
          cell.classList.add('has', 'added');
          cell.textContent = '◆ added here';
          cell.title = `This sheet came with this revision (its page ${opair[1] + 1}). `
            + 'It is the project\'s own drawing of the sheet, not another version of it '
            + '— click to open it.';
          cell.addEventListener('click', () => this.host.showOwn(i));
        } else if (!ok) {
          cell.classList.add('none');
          cell.title = `${revName(rev, c, s.names)} did not reissue this sheet`;
        } else {
          cell.classList.add('has');
          cell.textContent = revPageLabel(rev, rp) || '●';
          cell.title = `${revName(rev, c, s.names)}${rev.date ? ` — ${rev.date}` : ''}`
            + `\npage ${rp + 1} of that set`;
          if (String(rev.id) === (newest || '')) cell.classList.add('newest');
          if (isMain && i === s.page && viewing === String(rev.id)) cell.classList.add('on');
          cell.addEventListener('click', () => {
            if (isMain) this.host.showVersion(i, String(rev.id));
            else this.host.showLoosePage(rev, rp);
          });
        }
        row.appendChild(cell);
      });
      table.appendChild(row);
    }

    wrap.appendChild(table);
    wrap.appendChild(this._legend());
    return wrap;
  }

  _legend() {
    const l = el('div', 'rp-legend');
    const item = (cls, text) => {
      const s = el('span', 'rp-leg');
      s.appendChild(el('i', `rp-swatch ${cls}`));
      s.appendChild(el('span', null, text));
      return s;
    };
    l.appendChild(item('has', 'has this sheet'));
    l.appendChild(item('newest', 'newest version'));
    l.appendChild(item('on', 'on screen now'));
    l.appendChild(item('slot', 'new sheet'));
    l.appendChild(item('added', '◆ added by a revision'));
    return l;
  }

  // ── the current set ────────────────────────────────────────────────────

  _current(s, revs) {
    const wrap = el('div', 'rp-current');
    const mainLabels = Array.from({ length: s.pageCount },
      (_, i) => this.host.pageLabel(i));
    const order = s.order || 'date';
    // With the sheets a revision ADDED ranked as what they are, their pages
    // not loose, and every revision under its one name.
    const { rows, notes } = resolveLatestSheets(
      mainLabels, s.extraSheets || [], revs,
      { order, includeNew: true, origins: s.originMap, names: s.names });

    const bar = el('div', 'rp-cur-head');
    bar.appendChild(el('span', null,
      `${notes.sheets} sheets · ${notes.from_revisions} from a revision`
      + (notes.unmatched ? ` · ${notes.unmatched} unpaired` : '')));

    const sel = el('select', 'rp-order');
    for (const [v, t] of [['date', 'newest by date'], ['column', 'newest by list order']]) {
      const o = el('option', null, t);
      o.value = v;
      if (v === order) o.selected = true;
      sel.appendChild(o);
    }
    sel.title = 'How "newest" is decided. Dates are typed by hand and some are '
      + 'blank or unreadable; list order is what the matrix shows.';
    sel.addEventListener('change', () => this.host.setOrder(sel.value));
    bar.appendChild(sel);
    wrap.appendChild(bar);

    if (notes.undated && order === 'date') {
      const w = el('div', 'rp-warn');
      w.textContent = `${notes.undated} revision${notes.undated === 1 ? ' has' : 's have'}`
        + ' a date that cannot be read, so '
        + `${notes.undated === 1 ? 'it is' : 'they are'} ranked oldest. `
        + 'Switch to list order if that is wrong.';
      wrap.appendChild(w);
    }
    if (notes.duplicates.length) {
      const w = el('div', 'rp-warn');
      w.textContent = `Two rows share a sheet number: ${notes.duplicates.join(', ')}. `
        + 'Each row is a real page — but the numbering needs a look before '
        + 'anyone prints from it.';
      wrap.appendChild(w);
    }

    const list = el('div', 'rp-cur-list');
    for (const r of rows) {
      const row = el('div', 'rp-cur-row');
      row.appendChild(el('span', 'rp-no', r.sheet));
      const from = el('span', 'rp-cur-from', r.source);
      if (r.from[0] === 'rev') from.classList.add('rev');
      row.appendChild(from);
      row.appendChild(el('span', 'rp-cur-date', r.date || ''));
      const v = el('span', 'rp-cur-n',
        r.versions > 1 ? `${r.versions} versions` : '');
      row.appendChild(v);
      if (r.kind === 'new') {
        const b = el('span', 'rp-tag', 'not in this project');
        b.title = 'A page from a revision that is not paired with any sheet here.';
        row.appendChild(b);
      }
      row.addEventListener('click', () => {
        if (r.from[0] === 'main') this.host.showOwn(r.from[1]);
        else {
          const rev = revs[r.from[1]];
          const mainIdx = r.kind === 'main'
            ? (r.cols[0] ? r.cols[0][1] : null) : null;
          if (rev && mainIdx !== null && mainIdx !== undefined) {
            this.host.showVersion(mainIdx, String(rev.id));
          } else if (rev) {
            this.host.showLoosePage(rev, r.from[2]);
          }
        }
      });
      list.appendChild(row);
    }
    wrap.appendChild(list);
    return wrap;
  }
}

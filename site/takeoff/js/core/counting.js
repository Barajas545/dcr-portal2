// counting.js — WHAT COUNTS. Which piece of takeoff is in the totals, how much
// it adds, and every sentence that says so.
//
// A sheet can carry takeoff on several of its drawings — its own, and every
// revision that reissued it — and exactly ONE of them is in the totals: the
// one metadata.sheet_version books for it, the sheet's own drawing when there
// is no entry. Adding them all up would count the same wall twice on every
// report, which is what this app did until 3.05: it priced EVERY revision's
// takeoff, so the same file came to a different total here than on the
// desktop. On one real job the desktop priced 0 sq ft and this app 2,929.2.
//
// So this file is a PORT, not a design. Every method below is the desktop
// method of the same name (pdf_fast_viewer.py, PDFCacheViewer), line for line,
// and tests/revision-counting.mjs runs the desktop's own methods — lifted out
// of its source by text, as a closure — against these on the same inputs, so
// the two programs cannot disagree on a total without a red test.
//
// THE RULE THAT OUTRANKS EVERYTHING: a quantity that reaches the estimate
// must not change without a sentence on screen saying so, and the sentence
// names the QUANTITY. Looking never moves a price. The sentences are here,
// worded by the desktop's own functions (takeoff_move_words and friends), so
// "36 sq ft of Slab will leave" reads the same on both screens.
//
// Nothing here touches the DOM, and nothing here writes the project: a
// booking is RETURNED as data and the caller applies it inside the same undo
// step as the takeoff that caused it.

import {
  liveRevisions, visibleRevisions, revPageCount, sheetVersions, sheetRanks,
  newestVersionOf, workingVersionOf, revPageOf, itemOnDrawing, itemRevId,
  revNameOf, revisionNumber, revisionNamesOf, originMapOf, originPairsOf,
  originDateOf, pyInt, pyStr, isTakeoffType, KEPT_MARK_TYPES,
  resolveLatestSheets, onThisVersion,
} from './revisions.js';
import { pyFixed, pyRound, pyG, pyIntStr } from './pyformat.js';

export { isTakeoffType as isTakeoffItem, KEPT_MARK_TYPES };
export { pyFixed, pyRound, pyG };

/** The bucket for takeoff that belongs to the job rather than a sheet. */
export const STANDALONE = -1000;

/** desktop PIN_TYPES: one click on the plan that stands for one thing. */
export const PIN_TYPES = new Set(['window', 'door', 'partition', 'header']);

/** desktop REPORT_UNIT_BY_TYPE. */
const REPORT_UNIT_BY_TYPE = {
  area: 'SF', grid: 'SF', tile: 'SF', slope_area: 'SF',
  distance: 'LF', polyline: 'LF',
  count: 'EA', linear_count: 'EA',
};

// ── Python's number formatting, exactly ──────────────────────────────────
//
// The sentences are compared with the desktop's character for character, so
// "1,318.6 sq ft" has to round the way Python does: half to EVEN on the exact
// binary value. Number.prototype.toFixed rounds an exact tie UP (1.25 -> 1.3
// where Python says 1.2), so the digits are taken exactly and rounded in
// pyformat.js, which every number the app shows goes through.

/** {ok, n} — Python's float() of a JSON value. */
export function pyFloat(v) {
  if (typeof v === 'boolean') return { ok: true, n: v ? 1 : 0 };
  if (typeof v === 'number') return { ok: true, n: v };
  if (typeof v === 'string') {
    const t = v.trim().replace(/_/g, '');
    if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return { ok: true, n: Number(t) };
    if (/^[+-]?(inf|infinity)$/i.test(t)) return { ok: true, n: t[0] === '-' ? -Infinity : Infinity };
    if (/^[+-]?nan$/i.test(t)) return { ok: true, n: NaN };
  }
  return { ok: false, n: 0 };
}

/** Python truthiness of a JSON value. */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;      // NaN is truthy in Python
}

/** Python's `x or 0` for a number field. */
function orZero(v) {
  return truthy(v) ? v : 0;
}

// pyFixed, pyRound and pyG are pyformat.js's (every number the app shows
// goes through that one file), re-exported here for the modules that
// have always imported them from counting.js.

/**
 * Python's sum() of these numbers, read the way the desktop will read them
 * from the file THIS app writes.
 *
 * Since 3.12 CPython's sum() is not a running `+`. A leading run of ints is
 * added exactly, as ints; the first float is added to that with one plain
 * `+`; and only from there on are the bits each addition loses carried
 * (Neumaier's compensated sum, cs_add / cs_to_double) and added back at the
 * end. The desktop is built on 3.14, so a multi-shape item's total re-added
 * here with a plain `+` came out one bit off the desktop's -- 893.137374777004
 * against 893.1373747770041.
 *
 * Which numbers are ints is a fact of the TEXT, and the text is this app's:
 * JSON.stringify writes every whole number below 1e21 with no point -- a run
 * the desktop held as 180.0 is saved as 180 -- and Python reads that back as
 * an int. The desktop re-adds every multi-shape item from its runs whenever
 * it opens a job (_resync_group_totals), so this is the sum it re-adds from
 * a web save, and a total re-added here is the one it finds there, to the
 * bit. Compensating from the first number, as this did, missed by a bit
 * whenever a whole number came first, and the desktop then said on opening
 * that the item had been "re-added from its runs".
 *
 * What it cannot reach is a total the desktop added up itself and this app
 * saved untouched: added from 180.0 as a float, then re-added on opening from
 * 180 as an int, it can move one bit and be announced. That is the desktop's
 * to fix (compare totals past the last bit), not something a save may do.
 */
export function pySum(values) {
  const n = values.length;
  let i = 0;
  let hi = 0;
  // the leading whole numbers: ints in Python, added exactly
  while (i < n && isPyInt(values[i])) hi += values[i++];
  if (i === n) return hi;
  // the first float: one plain addition, nothing carried from it
  hi += values[i++];
  let lo = 0;
  for (; i < n; i++) {
    const x = values[i];
    const t = hi + x;
    if (Math.abs(hi) >= Math.abs(x)) lo += (hi - t) + x;
    else lo += (x - t) + hi;
    hi = t;
  }
  return lo && Number.isFinite(lo) ? hi + lo : hi;
}

/** A number this app writes as a JSON int, so Python reads an int. */
function isPyInt(x) {
  return Number.isInteger(x) && Math.abs(x) < 1e21;
}

// ── a piece of takeoff, by quantity ──────────────────────────────────────

/** (quantity, unit) of one takeoff item, the way the reports read it. */
export function takeoffQty(m) {
  const t = (m || {}).type || '';
  const v = orZero((m || {}).value);
  if (t === 'count') return [((m.points) || []).length, 'EA'];
  if (t === 'linear_count') {
    const f = pyFloat(v);
    return f.ok && Number.isFinite(f.n) ? [Math.trunc(f.n), 'EA'] : [0, ''];
  }
  if (PIN_TYPES.has(t)) return [1, 'EA'];
  if (t === 'standalone') {
    const q = pyFloat(orZero(m.qty));
    if (!q.ok) return [0, ''];
    return [q.n, String(m.unit || 'each').trim()];
  }
  const u = REPORT_UNIT_BY_TYPE[t] || '';
  const f = pyFloat(v);
  if (!f.ok) return [0, ''];
  return [f.n, u === 'SF' ? 'sq ft' : u];
}

/** 2929.21 sq ft -> '2,929.2 sq ft'. */
export function takeoffQtyText(q, u = '') {
  const f = pyFloat(q);
  let t = f.ok ? pyFixed(f.n, 1, true) : String(q);
  if (t.endsWith('.0')) t = t.slice(0, -2);
  return t + (u ? ` ${u}` : '');
}

function itemName(m) {
  return String((m || {}).name || (m || {}).label || '').trim() || 'an unnamed item';
}

/**
 * [qty, unit] of ONE SHAPE of takeoff — what is traced on the drawing it
 * sits on (desktop takeoff_shape_qty). A multi-sheet item keeps the whole
 * item's total on its first shape; a sentence about one drawing that read
 * it named the runs on every other sheet as if they were there.
 */
export function takeoffShapeQty(m) {
  if (m && truthy(m.group_id) && !truthy(m.group_child)) {
    const own = ('own_value' in m) ? orZero(m.own_value) : orZero(m.value);
    return takeoffQty({ ...m, value: own });
  }
  return takeoffQty(m);
}

/** " and 3 more (18.1 sq ft)" — the rest of a list, counted AND summed. */
function moreWords(n, qtys, extra = '') {
  const bits = [takeoffSumText(qtys), extra].filter(Boolean);
  return ` and ${n} more${bits.length ? ` (${bits.join(', ')})` : ''}`;
}

/**
 * [[name, unit, qty, run]] — the takeoff in `items` ONE ENTRY PER ITEM AS
 * HE SEES IT (desktop takeoff_quantity_entries): every shape of one name and
 * unit added up, by what is traced on its own drawing, first one first.
 * `run` when every shape in the entry is a run of an item that spans sheets.
 */
export function takeoffQuantityEntries(items) {
  const ents = [];
  const at = new Map();
  for (const m of items || []) {
    if (!isTakeoffType(m)) continue;
    const [q, u] = takeoffShapeQty(m);
    const nm = itemName(m);
    const k = JSON.stringify([nm, u]);
    if (at.has(k)) {
      const e = ents[at.get(k)];
      ents[at.get(k)] = [nm, u, e[2] + q, e[3] && truthy(m.group_child)];
    } else {
      at.set(k, ents.length);
      ents.push([nm, u, q, truthy(m.group_child)]);
    }
  }
  return ents;
}

/**
 * The takeoff in `items` by name and QUANTITY — "Deck 500 sq ft, Walls
 * 250 LF and 2 more (18.1 sq ft)" — because a sentence about money that
 * says "1 item" says nothing. Every shape by what is traced on its own
 * drawing, the first shape of a multi-sheet item included. One item, one
 * line: two shapes of one name are one entry, added up. '' when there is
 * no takeoff in it.
 */
export function takeoffQuantityWords(items, limit = 4) {
  const rows = [];
  const qtys = [];
  for (const [nm, u, q, run] of takeoffQuantityEntries(items)) {
    if (run) rows.push(`${takeoffQtyText(q, u)} of ${nm}`);
    else rows.push(`${nm} ${takeoffQtyText(q, u)}`);
    qtys.push([q, u]);
  }
  if (!rows.length) return '';
  let out = rows.slice(0, limit).join(', ');
  if (rows.length > limit) out += moreWords(rows.length - limit, qtys.slice(limit));
  return out;
}

/** [[qty, unit]] -> "2,929.2 sq ft" / "1,200 sq ft and 14 EA". */
export function takeoffSumText(qtys) {
  const tot = new Map();
  for (const [q, u] of qtys || []) {
    const f = pyFloat(orZero(q));
    if (!f.ok) continue;
    tot.set(u, (tot.get(u) || 0) + f.n);
  }
  const rows = [...tot.entries()].sort((a, b) => -Math.abs(a[1]) + Math.abs(b[1]));
  return rows.filter(([, q]) => q).map(([u, q]) => takeoffQtyText(q, u)).join(' and ');
}

/**
 * What a piece of takeoff IS, whichever object holds it: its type, its name,
 * the drawing it was traced on and its geometry (desktop _takeoff_identity).
 * An undo restores copies, so a move is matched by this and not by object.
 */
function identityParts(m) {
  m = m || {};
  let pts = '';
  try {
    pts = (m.points || []).filter(p => Array.isArray(p))
      .map(p => p.map(c => {
        const f = pyFloat(c);
        if (!f.ok) throw new Error('bad');
        return pyFixed(f.n, 3);
      }).join(',')).join(';');
  } catch {
    pts = '';
  }
  return [pyStr(m.type || ''), String(m.name || ''), String(m.rev_id || ''),
    pyStr(m.rev_page), String(m.group_id || ''), truthy(m.group_child) ? '1' : '0',
    pts];
}

export function takeoffIdentity(m) {
  return identityParts(m).join('\u0000');
}

/**
 * What a piece of takeoff is apart from its geometry (desktop
 * _takeoff_lineage): the SAME item before and after an edit to its shape.
 * Ctrl+Z of a count click put back a two-point Post, and matched by identity
 * alone it read "3 EA of Post leaves; 2 EA of Post comes in".
 */
export function takeoffLineage(m) {
  return identityParts(m).slice(0, -1).join('\u0000');
}

/** Python _round6: six places, 0 for anything unreadable or NaN. */
function round6(v) {
  const f = pyFloat(orZero(v));
  if (!f.ok || Number.isNaN(f.n)) return 0;
  const r = pyRound(f.n, 6);
  return Number.isNaN(r) ? 0 : r;
}

/** desktop _mat_merge: one row per material and unit, first one first. */
function matMerge(mats) {
  const out = [];
  const at = new Map();
  for (const [n, q, u] of mats || []) {
    const k = JSON.stringify([n, u]);
    if (at.has(k)) {
      const i = at.get(k);
      out[i] = [n, out[i][1] + q, u];
    } else {
      at.set(k, out.length);
      out.push([n, q, u]);
    }
  }
  return out;
}

/** desktop _flow_words: what entered and what left, never netted. */
function flowWords(ins, outs, future = false) {
  const bits = [];
  for (const [qtys, verbs] of [[ins, ['comes in', 'come in', 'will come in']],
    [outs, ['leaves', 'leave', 'will leave']]]) {
    const t = takeoffSumText(qtys);
    if (t) {
      bits.push(`${t} ${future ? verbs[2]
        : (new Set(qtys.map(x => x[1])).size === 1 ? verbs[0] : verbs[1])}`);
    }
  }
  return bits;
}

/**
 * desktop _price_key: what one unit of item `m` costs, as something two
 * items can share — the unit, the rate and what it is a rate per, and the
 * materials riding it. Compared for EQUALITY only, so any canonical form.
 */
function priceKey(m, u) {
  m = m || {};
  const mats = [];
  for (const ai of m.associated_items || []) {
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) continue;
    const mode = ('qty_mode' in ai) ? ai.qty_mode
      : (('qty_per' in ai) ? 'per_unit' : 'total');
    mats.push(JSON.stringify([String(truthy(ai.name) ? ai.name : '').trim(),
      String(truthy(('unit' in ai) ? ai.unit : 'each') ? (('unit' in ai) ? ai.unit : 'each') : ''),
      String(mode),
      round6(('qty' in ai) ? ai.qty : (('qty_per' in ai) ? ai.qty_per : 0)),
      round6(ai.unit_cost)]));
  }
  mats.sort();
  return JSON.stringify([String(u || ''), round6(m.unit_cost), 'rate_unit' in m,
    String(truthy(m.rate_unit) ? m.rate_unit : ''),
    String(truthy(m.catalog_unit) ? m.catalog_unit : ''), mats]);
}

/**
 * THE sentence for what a move does to the totals, by quantity (desktop
 * takeoff_move_words). `before` and `after` are Maps {key: [item, [qty,
 * unit]]} as countedQuantities() returns them. '' when nothing moves.
 *
 *   "1,318.6 sq ft of Slab leaves; 576.7 sq ft of Garage Slab comes in;
 *    Wall M 13 → 4 sq ft"
 *
 * ONE ITEM, ONE LINE: items of one name and unit are one line, and an item
 * whose shape changed is one change (matched by takeoffLineage). A change
 * of the materials riding an item is a change too. Past `limit` the BIGGEST
 * moves are named and the rest says what came in and what left separately —
 * never netted; a rest that moves both ways between differently priced
 * items (priceKey) is named in full.
 */
export function takeoffMoveWords(before, after, future = false, limit = 4) {
  const mats = (m, q) => takeoffMaterials(m, matParent(m, q));
  const sig = e => matMerge(mats(e[0], e[1][0]))
    .filter(([, x]) => round6(x))
    .map(([n, x, u]) => JSON.stringify([n, u, round6(x)])).sort().join('\u0001');
  const moved = (b, a) => !(b[1][0] === a[1][0] && b[1][1] === a[1][1]) || sig(b) !== sig(a);
  const lines = (keys, src) => {
    const out = [];
    const at = new Map();
    for (const k of keys) {
      const [m, [q, u]] = src.get(k);
      const key = JSON.stringify([itemName(m), u]);
      if (at.has(key)) {
        const ln = out[at.get(key)];
        ln[2] = ln[2] + q;
        ln[3].push(...mats(m, q));
      } else {
        at.set(key, out.length);
        out.push([itemName(m), u, q, [...mats(m, q)]]);
      }
    }
    return out;
  };
  const cut = (ls0) => {
    let ls = ls0;
    if (ls.length > limit) ls = [...ls].sort((x, y) => (-Math.abs(x[2])) - (-Math.abs(y[2])));
    let out = ls.slice(0, limit).map(([n, u, q, x]) => `${takeoffQtyText(q, u)} of ${n}`
      + materialsWords(matMerge(x))).join(', ');
    if (ls.length > limit) {
      const rest = ls.slice(limit);
      const mts = [];
      for (const ln of rest) mts.push(...matMerge(ln[3]));
      let extra = '';
      if (mts.length) {
        const ms = takeoffSumText(mts.map(([, q, u]) => [q, u]));
        extra = `with ${mts.length} material${mts.length === 1 ? '' : 's'}${ms ? `: ${ms}` : ''}`;
      }
      out += moreWords(rest.length, rest.map(ln => [ln[2], ln[1]]), extra);
    }
    return out;
  };
  let gone = [...before.keys()].filter(k => !after.has(k));
  let came = [...after.keys()].filter(k => !before.has(k));
  const chg = [...after.keys()].filter(k => before.has(k) && moved(before.get(k), after.get(k)))
    .map(k => [before.get(k), after.get(k)]);
  for (const ident of [takeoffIdentity, takeoffLineage]) {
    if (!(gone.length && came.length)) break;
    const waiting = new Map();
    for (const k of came) {
      const id = ident(after.get(k)[0]);
      if (!waiting.has(id)) waiting.set(id, []);
      waiting.get(id).push(k);
    }
    const left = [];
    const paired = new Set();
    for (const k of gone) {
      let hit = waiting.get(ident(before.get(k)[0]));
      if (hit && hit.length && ident === takeoffLineage) {
        // desktop: by lineage -- the geometry no longer matches -- a pair is
        // ONE item only if it is priced alike. Two items of one name on one
        // drawing priced apart, one leaving and the other arriving at the
        // same quantity, are a swap that moves money; unpaired, each is said.
        const pk = priceKey(before.get(k)[0], before.get(k)[1][1]);
        const j = hit.findIndex(k2 => priceKey(after.get(k2)[0], after.get(k2)[1][1]) === pk);
        hit = j >= 0 ? hit.splice(j, 1) : null;
      }
      if (hit && hit.length) {
        const k2 = hit.shift();
        paired.add(k2);
        if (moved(before.get(k), after.get(k2))) chg.push([before.get(k), after.get(k2)]);
      } else {
        left.push(k);
      }
    }
    gone = left;
    came = came.filter(k => !paired.has(k));
  }
  const bits = [];
  if (gone.length) {
    const gl = lines(gone, before);
    bits.push(`${cut(gl)} ${gl.length === 1
      ? (future ? 'will leave' : 'leaves') : (future ? 'will leave' : 'leave')}`);
  }
  if (came.length) {
    const cl = lines(came, after);
    bits.push(`${cut(cl)} ${cl.length === 1
      ? (future ? 'will come in' : 'comes in') : (future ? 'will come in' : 'come in')}`);
  }
  if (chg.length) {
    // One line per item as he sees it, and per direction.
    let cls = [];
    const at = new Map();
    for (const [[m0, [a, u]], [m1, [b, u2]]] of chg) {
      let way = null;
      if (u === u2) {
        const d = round6(b - a);
        way = (d > 0 ? 1 : 0) - (d < 0 ? 1 : 0);
      }
      const key = JSON.stringify([itemName(m1), u, u2, way]);
      const pk = [priceKey(m0, u), priceKey(m1, u2)];
      if (at.has(key)) {
        const ln = cls[at.get(key)];
        ln[3] = ln[3] + a;
        ln[4] = ln[4] + b;
        ln[5].push(...mats(m0, a));
        ln[6].push(...mats(m1, b));
        for (const p of pk) ln[7].add(p);
      } else {
        at.set(key, cls.length);
        cls.push([itemName(m1), u, u2, a, b, [...mats(m0, a)], [...mats(m1, b)], new Set(pk)]);
      }
    }
    const one = ([n, u, u2, a, b, x0, x1]) => {
      let t;
      if (u !== u2) t = `${n} ${takeoffQtyText(a, u)} → ${takeoffQtyText(b, u2)}`;
      else if (a === b) t = `${n} ${takeoffQtyText(b, u)}`;
      else t = `${n} ${takeoffQtyText(a)} → ${takeoffQtyText(b, u)}`;
      return t + materialsChangeWords(x0, x1, 2, future);
    };
    const size = ln => (ln[1] === ln[2] ? Math.abs(ln[4] - ln[3]) : Math.abs(ln[3]) + Math.abs(ln[4]));
    let rest = [];
    const ins = [];
    const outs = [];
    const mins = [];
    const mouts = [];
    if (cls.length > limit) {
      cls = [...cls].sort((x, y) => (-size(x)) - (-size(y)));
      rest = cls.slice(limit);
      for (const [, u, u2, a, b, x0, x1] of rest) {
        if (u === u2) {
          const d = round6(b - a);
          if (d > 0) ins.push([d, u]);
          else if (d < 0) outs.push([-d, u]);
        } else {
          if (round6(a)) outs.push([a, u]);
          if (round6(b)) ins.push([b, u2]);
        }
        const d0 = new Map(matMerge(x0).map(([mn, mq, mu]) => [JSON.stringify([mn, mu]), [mq, mu]]));
        const d1 = new Map(matMerge(x1).map(([mn, mq, mu]) => [JSON.stringify([mn, mu]), [mq, mu]]));
        for (const mk of [...d1.keys(), ...[...d0.keys()].filter(k => !d1.has(k))]) {
          const mu = (d1.get(mk) || d0.get(mk))[1];
          const d = round6((d1.has(mk) ? d1.get(mk)[0] : 0) - (d0.has(mk) ? d0.get(mk)[0] : 0));
          if (d > 0) mins.push([d, mu]);
          else if (d < 0) mouts.push([-d, mu]);
        }
      }
      const prices = new Set();
      for (const ln of rest) for (const p of ln[7]) prices.add(p);
      if ((ins.length || mins.length) && (outs.length || mouts.length) && prices.size > 1) rest = [];
    }
    const shown = cls.slice(0, cls.length - rest.length);
    let out = shown.map(one).join(', ');
    if (rest.length) {
      const fw = flowWords(ins, outs, future);
      const mw = flowWords(mins, mouts, future);
      out += ` and ${rest.length} more${fw.length ? `: ${fw.join(', ')}` : ''}`
        + `${mw.length ? ` (materials: ${mw.join(', ')})` : ''}`;
    }
    bits.push(out);
  }
  return bits.join('; ');
}

// ── an item's associated materials go wherever the item goes ────────────

/** Python's _ai_total: a material's quantity for its item's quantity. */
function aiTotal(ai, parentQty) {
  const qty = ('qty' in ai) ? ai.qty : (('qty_per' in ai) ? ai.qty_per : 0.0);
  const mode = ('qty_mode' in ai) ? ai.qty_mode : (('qty_per' in ai) ? 'per_unit' : 'total');
  return mode === 'total' ? qty : qty * parentQty;
}

/** The quantity per-unit materials multiply (desktop _mat_parent). */
function matParent(m, q) {
  if (m && truthy(m.group_id) && !truthy(m.group_child)) return q;
  return orZero((m || {}).value);
}

/** [[name, qty, unit]] of the materials riding item `m` (desktop takeoff_materials). */
export function takeoffMaterials(m, parentQty) {
  const out = [];
  for (const ai of (m || {}).associated_items || []) {
    if (!ai || typeof ai !== 'object' || Array.isArray(ai)) continue;
    let t;
    try {
      t = aiTotal(ai, parentQty);
    } catch {
      continue;
    }
    const f = pyFloat(orZero(t));
    if (!f.ok) continue;
    out.push([String(ai.name || '').trim() || '(material)', f.n,
      String((('unit' in ai) ? ai.unit : 'each') || '')]);
  }
  return out;
}

/** " (with 1 each of Dumpster 20yd and 27.5 LF of Rebar #4)". */
function materialsWords(mats, limit = 2) {
  if (!mats.length) return '';
  const rows = mats.map(([n, q, u]) => `${takeoffQtyText(q, u)} of ${n}`);
  let body;
  if (rows.length > limit) {
    const n = rows.length - limit;
    const rest = takeoffSumText(mats.slice(limit).map(([, q, u]) => [q, u]));
    body = `${rows.slice(0, limit).join(', ')} and ${n} more material${n === 1 ? '' : 's'}`
      + `${rest ? `: ${rest}` : ''}`;
  } else if (rows.length === 1) {
    body = rows[0];
  } else {
    body = `${rows.slice(0, -1).join(', ')} and ${rows[rows.length - 1]}`;
  }
  return ` (with ${body})`;
}

/**
 * " (Rebar #4 14.3 → 4.4 LF, 1 each of Dumpster 20yd leaves)" (desktop
 * _materials_change_words): an item's materials before (`x0`) and after
 * (`x1`), material by material. Past `limit` the biggest are named and the
 * rest say what entered and what left, never netted; a rest that moves both
 * ways is named in full.
 */
function materialsChangeWords(x0in, x1in, limit = 2, future = false) {
  const x0 = matMerge(x0in);
  const x1 = matMerge(x1in);
  const d0 = new Map(x0.map(([n, q, u]) => [JSON.stringify([n, u]), [n, q, u]]));
  const d1 = new Map(x1.map(([n, q, u]) => [JSON.stringify([n, u]), [n, q, u]]));
  let rows = [];
  for (const k of [...d1.keys(), ...[...d0.keys()].filter(kk => !d1.has(kk))]) {
    const e0 = d0.get(k);
    const e1 = d1.get(k);
    const [n, , u] = e1 || e0;
    let t;
    if (e0 && e1) {
      if (round6(e0[1]) === round6(e1[1])) continue;
      t = `${n} ${takeoffQtyText(e0[1])} → ${takeoffQtyText(e1[1], u)}`;
    } else if (e1) {
      if (!round6(e1[1])) continue;
      t = `${takeoffQtyText(e1[1], u)} of ${n} ${future ? 'will come in' : 'comes in'}`;
    } else {
      if (!round6(e0[1])) continue;
      t = `${takeoffQtyText(e0[1], u)} of ${n} ${future ? 'will leave' : 'leaves'}`;
    }
    rows.push([round6((e1 ? e1[1] : 0) - (e0 ? e0[1] : 0)), u, t]);
  }
  if (!rows.length) return '';
  if (rows.length > limit) {
    rows = [...rows].sort((x, y) => (-Math.abs(x[0])) - (-Math.abs(y[0])));
    const rest = rows.slice(limit);
    const ins = rest.filter(r => r[0] > 0).map(r => [r[0], r[1]]);
    const outs = rest.filter(r => r[0] < 0).map(r => [-r[0], r[1]]);
    if (!(ins.length && outs.length)) {
      const n = rest.length;
      return ` (${rows.slice(0, limit).map(r => r[2]).join(', ')} and ${n} more material${n === 1 ? '' : 's'}`
        + `${(ins.length || outs.length) ? `: ${flowWords(ins, outs, future).join(', ')}` : ''})`;
    }
  }
  return ` (${rows.map(r => r[2]).join(', ')})`;
}

/** "3 items", "1 item and 2 shapes of items that span sheets", "nothing". */
export function amountWords(items, runs = 0) {
  const bits = [];
  if (items) bits.push(`${items} item${items === 1 ? '' : 's'}`);
  if (runs) bits.push(`${runs} shape${runs === 1 ? '' : 's'} of items that span sheets`);
  return bits.join(' and ') || 'nothing';
}

/**
 * What a move ADDS to the totals in all, by unit — "2,929.2 sq ft" — when it
 * only adds; '' when anything leaves or shrinks (desktop _totals_gain_text).
 */
export function totalsGainText(before, after) {
  for (const k of before.keys()) if (!after.has(k)) return '';
  const gain = [];
  for (const [k, [, [q0n, u]]] of after.entries()) {
    let q = q0n;
    if (before.has(k)) {
      const [qb, ub] = before.get(k)[1];
      if (ub !== u || q < qb) return '';
      q -= qb;
    }
    gain.push([q, u]);
  }
  return takeoffSumText(gain);
}

// ── the model: one job's book, asked every question the desktop asks ────

/**
 * Every counting question, asked of one job as it stands.
 *
 *   metadata      the project's metadata (revisions, sheet_version,
 *                 sheet_origin, page_labels, page_labels_custom, extra_sheets)
 *   measurements  {pageKey: [item]}
 *   pageCount     how many sheets
 *   order         'date' | 'column' — how "newest" is decided
 *   sizeOf        (page) -> [w, h] | null and
 *   revSizeOf     (rev, revPage) -> [w, h] | null, for the "another sheet
 *                 size" rule; unknown sizes pass, as the desktop's do
 *
 * Cheap to build: it holds references, reads on demand and caches nothing,
 * so a model made before an edit answers about the job after it.
 */
export class CountingModel {
  constructor({ metadata, measurements, pageCount, order = 'date',
    sizeOf = null, revSizeOf = null }) {
    this.md = metadata || {};
    this.meas = measurements || {};
    this.n = Number(pageCount) || 0;
    this.order = order === 'column' ? 'column' : 'date';
    this.sizeOf = sizeOf;
    this.revSizeOf = revSizeOf;
  }

  /** The same job with another book / without some revisions — a question. */
  variant({ sheetVersion, dropRevs = null } = {}) {
    const md = { ...this.md };
    if (sheetVersion === null) delete md.sheet_version;
    else if (sheetVersion !== undefined) md.sheet_version = sheetVersion;
    if (dropRevs && dropRevs.size) {
      md.revisions = (this.md.revisions || []).filter(r => !dropRevs.has(String(r.id)));
    }
    return new CountingModel({ metadata: md, measurements: this.meas,
      pageCount: this.n, order: this.order, sizeOf: this.sizeOf, revSizeOf: this.revSizeOf });
  }

  /** The revisions the desktop has (liveRevisions). */
  get revs() { return liveRevisions(this.md.revisions); }

  /** Page keys of the store, in its own order, as numbers. */
  pageKeys() {
    return Object.keys(this.meas).map(Number).filter(k => Number.isFinite(k));
  }

  items(page) {
    return this.meas[page] || this.meas[String(page)] || [];
  }

  // ── names ──────────────────────────────────────────────────────────

  /** desktop _page_final_label. */
  pageLabel(idx) {
    if (idx === null || idx === undefined || idx < 0) return '—';
    const custom = this.md.page_labels_custom || {};
    const labels = this.md.page_labels || [];
    let lbl = custom[String(idx)] || (idx < labels.length ? labels[idx] : '');
    lbl = String(lbl || '').trim();
    return lbl || `Pag: ${idx + 1}`;
  }

  revName(rid, hiddenNote = false) { return revNameOf(rid, this.revs, hiddenNote); }
  revisionLabel(rid) { return this.revName(rid, true); }
  revisionNames() { return revisionNamesOf(this.revs); }
  revisionNumber(rid) { return revisionNumber(rid, this.revs); }
  revTag(rid, hiddenNote = false) { return this.revName(rid, hiddenNote); }

  /** 'ASI 7 · 10/05/2026', 'REV 2 · 10/05/2026 · New changes as of …'. */
  revTitle(rid) {
    const n = this.revisionNumber(rid);
    if (!n) return this.revisionLabel(rid) || 'its own drawing';
    const rev = this.revs[n - 1];
    const nm = this.revName(rid);
    const bits = [nm];
    const d = String(rev.date || '').trim();
    const s = String(rev.description || '').split(/\s+/).filter(Boolean).join(' ');
    if (d) bits.push(d);
    if (s && s !== nm) bits.push([...s].length <= 60 ? s : `${[...s].slice(0, 57).join('').trimEnd()}…`);
    let t = bits.join(' · ');
    if (!(rev.visible !== false && !rev.archived)) t += ' (hidden)';
    return t;
  }

  /** 'REV 2', or "its own drawing". */
  versionName(rid) { return this.revTag(rid) || 'its own drawing'; }

  // ── the drawings of a sheet ────────────────────────────────────────

  visibleRevisions() { return visibleRevisions(this.revs); }
  sheetVersions(page) { return sheetVersions(page, this.revs, this.md.sheet_origin); }
  sheetRanks(page) { return sheetRanks(page, this.revs, this.order, this.md.sheet_origin); }
  newestVersionOf(page) { return newestVersionOf(page, this.revs, this.order, this.md.sheet_origin); }
  originDate(page) { return originDateOf(page, this.md.sheet_origin, this.revs); }
  originMap() { return originMapOf(this.md.sheet_origin, this.revs); }
  originPairs() { return originPairsOf(this.md.sheet_origin); }

  // ── what counts ────────────────────────────────────────────────────

  workingVersionOf(page) { return workingVersionOf(page, this.revs, this.md.sheet_version); }
  revPageOf(page, rid) { return revPageOf(page, rid, this.revs); }
  itemOnDrawing(page, rid, m) { return itemOnDrawing(page, rid, m, this.revs); }

  /** Whether ONE run is on a drawing its sheet is counted from. */
  runCountsTowards(page, m) {
    if (!Number.isInteger(page) || page < 0) return true;
    const rid = itemRevId(m);
    if (rid !== this.workingVersionOf(page)) return false;
    return !rid || this.itemOnDrawing(page, rid, m);
  }

  /** All [page, item] of one multi-shape item — master first, then by page. */
  measurementGroup(gid) {
    const out = [];
    for (const pg of this.pageKeys().sort((a, b) => a - b)) {
      for (const m of this.items(pg)) {
        if (m && m.group_id === gid) out.push([pg, m]);
      }
    }
    return out.map((t, i) => [t, i])
      .sort((a, b) => (truthy(a[0][1].group_child) - truthy(b[0][1].group_child))
        || (a[0][0] - b[0][0]) || (a[1] - b[1]))
      .map(x => x[0]);
  }

  /**
   * Whether one ITEM is in the totals. A multi-shape item is in the bid
   * whenever ANY of its runs is: its total is already the sum of the runs
   * that count, and dropping it whole would take the counted runs with it.
   */
  itemCountsTowards(page, m) {
    if (!Number.isInteger(page) || page < 0) return true;
    const gid = m && m.group_id;
    if (truthy(gid) && !truthy(m.group_child)) {
      const shapes = this.measurementGroup(gid);
      if (shapes.length) return shapes.some(([pg, sh]) => this.runCountsTowards(pg, sh));
    }
    return this.runCountsTowards(page, m);
  }

  /**
   * [qty, unit] one item adds to the totals as the book stands. A
   * multi-sheet item is re-added from the runs that count — the arithmetic
   * of the desktop's _sync_group, without writing the item's total.
   */
  countedQty(page, m) {
    const gid = m && m.group_id;
    if (!truthy(gid) || truthy(m.group_child)) return takeoffQty(m);
    const shapes = this.measurementGroup(gid);
    const mine = this.runCountsTowards(page, m);
    const own = ('own_value' in m) ? m.own_value : (('value' in m) ? m.value : 0);
    let tot = mine ? Number(orZero(own)) || 0 : 0;
    for (const [p, c] of shapes) {
      if (truthy(c.group_child) && this.runCountsTowards(p, c)) {
        tot += Number(orZero(('value' in c) ? c.value : 0)) || 0;
      }
    }
    return takeoffQty({ ...m, value: tot });
  }

  /**
   * Map {item: [item, [qty, unit]]} of every takeoff item in the totals — a
   * multi-sheet item once, by its master. THE totals: every report, export
   * and sentence about money reads them.
   */
  countedQuantities() {
    const out = new Map();
    for (const pg of this.pageKeys()) {
      for (const m of this.items(pg)) {
        if (!isTakeoffType(m) || truthy(m.group_child)) continue;
        if (this.itemCountsTowards(pg, m)) out.set(m, [m, this.countedQty(pg, m), pg]);
      }
    }
    return out;
  }

  /**
   * [before, after] — what a move does to the totals: the sheets in `book`
   * ({page: revId}, '' for the sheet's own drawing) counted from those
   * drawings, the revisions in `dropRevs` gone. Nothing is changed.
   */
  totalsEffect({ book = null, dropRevs = [] } = {}) {
    const before = this.countedQuantities();
    const drop = new Set((dropRevs || []).filter(Boolean).map(String));
    if ((!book || !Object.keys(book).length) && !drop.size) return [before, new Map(before)];
    let nb = { ...(this.md.sheet_version || {}) };
    for (const [pg, rid] of Object.entries(book || {})) {
      if (rid) nb[String(pg)] = String(rid);
      else delete nb[String(pg)];
    }
    if (drop.size) nb = Object.fromEntries(Object.entries(nb).filter(([, v]) => !drop.has(String(v))));
    const after = this.variant({ sheetVersion: nb, dropRevs: drop }).countedQuantities();
    return [before, after];
  }

  totalsEffectWords({ book = null, dropRevs = [], future = true } = {}) {
    const [b, a] = this.totalsEffect({ book, dropRevs });
    return takeoffMoveWords(b, a, future);
  }

  /**
   * Map {revId: items} on the DRAWINGS of one sheet; a run is not an item of
   * its own, and an item whose page is no drawing of the sheet now is on no
   * version of it (takeoffOnDrawings).
   */
  itemsByVersion(page) {
    const out = new Map();
    for (const [rid, [a]] of this.takeoffOnDrawings(page).byRev) {
      if (a) out.set(rid, a);
    }
    return out;
  }

  /**
   * The takeoff on one sheet by the DRAWING it was traced on (desktop
   * `_takeoff_on_drawings`): {byRev: Map{revId: [items, runs]}, waiting:
   * [items, runs]}. A piece stamped with a page of a revision is that
   * revision's only while the page is its drawing of this sheet
   * (itemOnDrawing, the canvas's own question); otherwise it waits. A
   * revision not in the job at all (deleted, or waiting to be imported
   * again) has no pages to ask: its takeoff stays under its id.
   */
  takeoffOnDrawings(page) {
    const byRev = new Map();
    let wItems = 0, wRuns = 0;
    const live = new Set(this.revs.map(r => String(r.id)));
    for (const m of this.items(page)) {
      if (!isTakeoffType(m)) continue;
      const run = truthy(m.group_child);
      const rid = itemRevId(m);
      if (rid && live.has(rid) && !this.itemOnDrawing(page, rid, m)) {
        if (run) wRuns += 1; else wItems += 1;
        continue;
      }
      const [a, b] = byRev.get(rid) || [0, 0];
      byRev.set(rid, run ? [a, b + 1] : [a + 1, b]);
    }
    return { byRev, waiting: [wItems, wRuns] };
  }

  /** [items, runs] of takeoff on one drawing of a sheet — the drawing `rid`
   *  shows for it NOW. */
  takeoffAmount(page, rid) {
    const got = this.takeoffOnDrawings(page).byRev.get(String(rid || ''));
    return got ? [got[0], got[1]] : [0, 0];
  }

  /** The takeoff on `page` that is in the totals now. */
  countedTakeoffOn(page) {
    return this.items(page).filter(m => isTakeoffType(m) && this.runCountsTowards(page, m));
  }

  /** Where a revision page sits now: ['sheet', i] | ['slot', id] | null. */
  revPageHome(rev, rp) {
    for (const [k, v] of Object.entries(rev.match || {})) {
      if (v === rp) {
        const i = pyInt(k);
        return i.ok ? ['sheet', i.n] : null;
      }
    }
    for (const [k, v] of Object.entries(rev.extra || {})) {
      if (v === rp) return ['slot', k];
    }
    return null;
  }

  slotById(sid) {
    return (this.md.extra_sheets || []).find(s => s && s.id === sid) || null;
  }

  /**
   * Why a piece of takeoff counts NOWHERE — its drawing is no drawing of its
   * sheet now — or ''. `short` is the table cell, otherwise the sentence.
   */
  waitingReason(page, m, short = false) {
    if (!(Number.isInteger(page) && page >= 0 && page < this.n)) return '';
    if (!isTakeoffType(m)) return '';
    const rid = itemRevId(m);
    if (!rid) return '';
    const rev = this.revs.find(r => String(r.id) === rid) || null;
    const nm = this.revName(rid);
    if (!rev) {
      return short ? 'a revision since removed'
        : 'traced on a revision since removed from the project — it counts nowhere, and no drawing shows it';
    }
    if (this.revPageOf(page, rid) !== null && this.itemOnDrawing(page, rid, m)) return '';
    const rpi = pyInt(m.rev_page);
    const rp = (m.rev_page === undefined || m.rev_page === null || !rpi.ok) ? null : rpi.n;
    if (rp === null) {
      return short ? `${nm}, no longer a drawing of this sheet`
        : `traced on ${nm}, which is no longer a drawing of this sheet — it counts nowhere until that revision is paired with it again`;
    }
    const h = this.revPageHome(rev, rp);
    const where = `page ${rp + 1} of ${nm}`;
    if (h && h[0] === 'slot') {
      const row = String((this.slotById(h[1]) || {}).label || '').trim();
      return short ? `${where}, waiting in the Pages list`
        : `traced on ${where}, which waits on its own row in the Pages list`
          + `${row && row !== 'NEW SHEET' ? ` (${row})` : ''} — it counts nowhere until you click that row and say what the page is`;
    }
    if (h && h[0] === 'sheet') {
      const other = this.pageLabel(h[1]);
      return short ? `${where}, now a drawing of ${other}`
        : `traced on ${where}, which is now a drawing of ${other} — it counts nowhere until it is carried there`;
    }
    return short ? `${where}, under NEW in the revision matrix`
      : `traced on ${where}, which is a drawing of no sheet now (under NEW in the revision matrix) — it counts nowhere until you pair that page with a sheet or add it as one`;
  }

  /**
   * keep(page, item) — whether an item counts, with `.run` (one run),
   * `.waiting` (why it counts nowhere, short) and `.book` ({page: revId}).
   */
  countedFilter() {
    const keep = (pg, m) => this.itemCountsTowards(pg, m);
    const book = {};
    for (let p = 0; p < this.n; p++) {
      const rid = this.workingVersionOf(p);
      if (rid) book[p] = rid;
    }
    keep.book = book;
    keep.run = (pg, m) => this.runCountsTowards(pg, m);
    keep.waiting = (pg, m) => this.waitingReason(pg, m, true);
    return keep;
  }

  /** [[page, item]] stamped with a version this sheet no longer has. */
  orphanItems() {
    const out = [];
    for (const page of this.pageKeys()) {
      if (page < 0) continue;
      const have = new Set(this.revs
        .filter(r => (r.match || {})[String(page)] !== undefined && (r.match || {})[String(page)] !== null)
        .map(r => String(r.id)));
      for (const m of this.items(page)) {
        if (!isTakeoffType(m)) continue;
        const rid = itemRevId(m);
        if (rid && (!have.has(rid) || !this.itemOnDrawing(page, rid, m))) out.push([page, m]);
      }
    }
    return out;
  }

  // ── pins and notes come home ───────────────────────────────────────

  /**
   * [revId, revPage] of the drawing an item is SHOWN on: its stamp — except
   * a callout pin or a text note whose drawing this sheet no longer has,
   * which comes back to the sheet's own drawing so it can still be reached.
   * The stamp itself is kept. Takeoff never falls back.
   */
  markVersion(page, m) {
    const rid = itemRevId(m);
    const rp = (m || {}).rev_page;
    if (!rid || !KEPT_MARK_TYPES.has((m || {}).type)) return [rid, rp === undefined ? null : rp];
    for (const v of this.sheetVersions(page)) {
      if (v.revId !== rid) continue;
      if (rp === undefined || rp === null) return [rid, null];
      const a = pyInt(rp), b = pyInt(v.revPage);
      if (!a.ok || !b.ok) return [rid, rp];
      if (a.n === b.n) return [rid, rp];
    }
    return ['', null];
  }

  /** Is this item shown on the drawing `rid` shows for `page`? */
  markOnDrawing(page, rid, m) {
    const [mrid, mrp] = this.markVersion(page, m);
    if (mrid !== String(rid || '')) return false;
    if (!mrid || mrp === null || mrp === undefined) return true;
    const n = pyInt(mrp);
    if (!n.ok) return true;
    const now = this.revPageOf(page, mrid);
    return now !== null && Number(now) === n.n;
  }

  // ── the "another sheet size" rule ──────────────────────────────────

  versionTakeoffSizeOk(page, rid) {
    const r = String(rid || '');
    if (!r || !(page >= 0 && page < this.n)) return true;
    const hit = this.sheetVersions(page).find(v => v.revId === r);
    if (!hit) return true;
    if (!(hit.revPage >= 0 && hit.revPage < revPageCount(hit.rev))) return true;
    const ps = this.sizeOf ? this.sizeOf(page) : null;
    const rs = this.revSizeOf ? this.revSizeOf(hit.rev, hit.revPage) : null;
    if (!ps || !rs) return true;
    return Math.abs(rs[0] - ps[0]) <= 2 && Math.abs(rs[1] - ps[1]) <= 2;
  }

  // ── changing which drawing counts ──────────────────────────────────

  /**
   * desktop set_working_version, as a QUESTION: what the book becomes if
   * `page` counts from `rid`, or null when it may not ('' is the sheet's own
   * drawing). The caller writes it (applyBooking) — inside the undo step of
   * the takeoff that caused it, when one did.
   */
  workingVersionChange(page, rid0) {
    if (!(page >= 0 && page < this.n)) return null;
    const rid = String(rid0 || '');
    if (rid && !this.sheetVersions(page).some(v => v.revId === rid)) return null;
    if (rid && !this.takeoffAmount(page, rid).reduce((a, b) => a + b, 0)
        && !this.versionTakeoffSizeOk(page, rid)) return null;
    const book = { ...(this.md.sheet_version || {}) };
    const was = String(book[String(page)] || '');
    if (was === rid) return null;
    if (rid) book[String(page)] = rid;
    else delete book[String(page)];
    let bookedOver = null;
    if (rid) {
      const rv = this.revs.find(r => String(r.id) === rid);
      const rp = this.revPageOf(page, rid);
      if (rv && rp !== null) bookedOver = { revId: rid, revPage: rp, was };
    }
    return { page, rid, was, book: Object.keys(book).length ? book : null, bookedOver };
  }

  /**
   * The first takeoff on a sheet BOOKS the drawing it was traced on (desktop
   * _book_first_takeoff): if the sheet holds no takeoff on ANY of its
   * drawings — a raw scan; runs, hidden layers and orphans all count as
   * takeoff, notes, pins and rulers do not — the drawing `m` lands on
   * becomes the one it counts from. That moves no number but the one he just
   * drew. null when nothing is booked; else the change and the sentence.
   * Asked BEFORE `m` is filed.
   */
  firstTakeoffBooking(page, m) {
    if (!isTakeoffType(m)) return null;
    if (!(Number.isInteger(page) && page >= 0 && page < this.n)) return null;
    if (this.items(page).some(x => isTakeoffType(x))) return null;
    const rid = itemRevId(m);
    const book = this.md.sheet_version || {};
    if (String(book[String(page)] || '') === rid) return null;
    if (rid && !this.sheetVersions(page).some(v => v.revId === rid)) return null;
    const was = this.workingVersionOf(page);
    // The totals before this takeoff, so its sentence can name what came in.
    const before = this.countedQuantities();
    const ch = this.workingVersionChange(page, rid);
    if (!ch) return null;
    const after = this.variant({ sheetVersion: ch.book });
    const says = after.workingVersionOf(page) !== was;
    return { ...ch, before, says };
  }

  /**
   * The booking's sentence, worded on the job AFTER the takeoff was filed
   * (desktop _book_first_takeoff's deferred words): what came into the
   * totals, by quantity. Worded before, it named what the tool held, not
   * what was filed.
   */
  firstTakeoffSaid(page, rid, before) {
    const moved = takeoffMoveWords(before, this.countedQuantities());
    return `${this.pageLabel(page)} now counts from ${this.versionName(rid)} — the drawing `
      + `you are taking off${moved ? `; in your totals: ${moved}` : ''}. Nothing was taken `
      + 'off any of its other drawings, so no other total moved.';
  }

  /**
   * The question asked when takeoff lands on a drawing its sheet does NOT
   * count from (desktop _ask_count_after_takeoff + ask_count_version): the
   * lead, and the body with the before and the after. null when there is
   * nothing to ask.
   */
  countQuestion(page, rid0, lead = '') {
    const rid = String(rid0 || '');
    const was = this.workingVersionOf(page);
    if (rid === was) return null;
    const sheet = this.pageLabel(page);
    const toName = this.versionName(rid);
    const fromName = this.versionName(was);
    const hasTo = this.takeoffAmount(page, rid).reduce((a, b) => a + b, 0);
    // A drawing nothing can be traced on is a drawing this sheet would
    // contribute nothing from, for good: refused, and said why.
    if (!hasTo && !this.versionTakeoffSizeOk(page, rid)) {
      return { page, rid, was, refused: `${sheet} cannot count from ${toName}: it was reissued `
        + 'at a different sheet size, so nothing can be traced on it — the scale is the '
        + 'sheet’s, measured on the sheet’s own drawing. '
        + `${sheet} would contribute nothing, for good. Nothing was changed.` };
    }
    const moved = this.totalsEffectWords({ book: { [page]: rid } });
    let body = `${sheet} will count from ${toName} instead of ${fromName}.\n\n`
      + (moved ? `In your totals: ${moved}.`
        : 'Your totals do not change: nothing taken off either drawing counts differently.')
      + '\n\nNothing is deleted: the takeoff on every other version stays where it is, and is '
      + 'listed on the report as not counted. You can change this back the same way.';
    if (lead) body = `${lead}\n\n${body}`;
    if (!hasTo) {
      body += '\n\nThere is no takeoff on that drawing yet, so this sheet will contribute '
        + 'nothing until you take it off.';
    }
    return { page, rid, was, body, moved };
  }

  /** The lead of that question: why he is asked (desktop wording). */
  afterTakeoffLead(page, m) {
    const rid = itemRevId(m);
    const was = this.workingVersionOf(page);
    const just = takeoffQuantityWords([m]);
    const counted = this.countedTakeoffOn(page);
    const there = takeoffQuantityWords(counted);
    return `What you just took off on ${this.versionName(rid)}${just ? ` (${just})` : ''} is not `
      + `in your totals: ${this.pageLabel(page)} counts from ${this.versionName(was)}, `
      + (there ? `where ${there} ${takeoffQuantityEntries(counted).length === 1 ? 'is' : 'are'} in your totals`
        : 'which holds nothing that counts')
      + '.';
  }

  /** "<sheet> now counts from X instead of Y — in your totals: ...". */
  bookedSentence(page, rid, was, before, after) {
    const moved = takeoffMoveWords(before, after);
    return `${this.pageLabel(page)} now counts from ${this.versionName(rid)} instead of `
      + `${this.versionName(was)} — ${moved ? `in your totals: ${moved}` : 'your totals did not change'}.`;
  }

  /** The No to that question, said (desktop wording). */
  declinedSentence(page, m) {
    const rid = itemRevId(m);
    const just = takeoffQuantityWords([m]);
    return `${this.pageLabel(page)} still counts from ${this.versionName(this.workingVersionOf(page))}. `
      + `What you take off on ${this.versionName(rid)}${just ? ` (${just})` : ''} is kept and marked `
      + 'NOT COUNTED — it is not in your totals. Count this version, on the version bar, changes that.';
  }

  // ── jobs taken off on a drawing that does not count ────────────────

  /**
   * [[page, revId, items, runs]] for every sheet whose takeoff is ALL on one
   * drawing, when that is not the drawing the sheet counts from — the state
   * of every job taken off on a revision before 3.05 (desktop
   * _lone_uncounted_sheets).
   */
  loneUncountedSheets() {
    const out = [];
    for (let page = 0; page < this.n; page++) {
      const raw = this.items(page).filter(m => isTakeoffType(m));
      if (!raw.length) continue;
      const rids = new Set(raw.map(itemRevId));
      if (rids.size !== 1) continue;
      const rid = [...rids][0];
      if (rid === this.workingVersionOf(page)) continue;
      if (rid && !this.sheetVersions(page).some(v => v.revId === rid)) continue;
      if (rid && !raw.every(m => this.itemOnDrawing(page, rid, m))) continue;
      if (!this.versionTakeoffSizeOk(page, rid)) continue;
      const [items, runs] = this.takeoffAmount(page, rid);
      out.push([page, rid, items, runs]);
    }
    return out;
  }

  /**
   * One line naming takeoff that is not in the totals because its sheet
   * counts another drawing — the sheets, how much, and where the list marks
   * them (desktop _left_out_sentence).
   */
  leftOutSentence(lone, lead) {
    const tItems = lone.reduce((s, x) => s + x[2], 0);
    const tRuns = lone.reduce((s, x) => s + x[3], 0);
    const n = lone.length;
    const names = lone.slice(0, 6).map(x => this.pageLabel(x[0])).join(', ') + (n > 6 ? '…' : '');
    const held = [];
    for (const [p, r] of lone) {
      for (const m of this.items(p)) if (isTakeoffType(m) && itemRevId(m) === r) held.push(m);
    }
    const sum = takeoffSumText(held.map(takeoffShapeQty));
    const what = takeoffQuantityWords(held) || amountWords(tItems, tRuns);
    return `${lead}: ${what}${sum && held.length > 1 ? ` (${sum} in all)` : ''} on ${n} sheet`
      + `${n === 1 ? '' : 's'} (${names}) stay${(tItems + tRuns) === 1 ? 's' : ''} out of your `
      + `totals — taken off on a drawing ${n === 1 ? 'that sheet does' : 'those sheets do'} not `
      + `count from. The ⚠ tiles in the Pages list mark ${n === 1 ? 'it' : 'them'}.`;
  }

  // ── a sheet whose counted drawing is empty while another holds takeoff ─

  /**
   * {page: [working, here, other]} — what the watch compares between two
   * moments (desktop _watch_counted_takeoff's state, keyed by page here: a
   * page insert or delete re-primes it).
   */
  countedState() {
    const out = {};
    for (let page = 0; page < this.n; page++) {
      const raw = new Map();
      for (const m of this.items(page)) {
        if (!isTakeoffType(m)) continue;
        const r = itemRevId(m);
        raw.set(r, (raw.get(r) || 0) + 1);
      }
      if (!raw.size) continue;
      const wid = this.workingVersionOf(page);
      const here = raw.get(wid) || 0;
      let tot = 0;
      for (const v of raw.values()) tot += v;
      out[page] = [wid, here, tot - here];
    }
    return out;
  }

  /**
   * The sentence for the sheets that have just come to HOLD takeoff that
   * does not count while their counted drawing holds nothing — '' when none
   * did. `prev` is countedState() from before the edit.
   */
  watchSentence(prev) {
    const now = this.countedState();
    let said = [];
    for (const [k, [wid, nHere, nOther]] of Object.entries(now)) {
      const p = prev ? prev[k] : undefined;
      if (p !== undefined && p[0] !== wid) continue;     // the book moved: said by its mover
      const [pHere, pOther] = p ? [p[1], p[2]] : [0, 0];
      if (nHere === 0 && nOther > 0 && !(pHere === 0 && pOther > 0)) {
        said.push([Number(k), wid, pHere > 0]);
      }
    }
    if (!said.length) return '';
    // A drawing that is not in the job YET -- its revision parked until it
    // is imported again -- can be neither opened nor counted: that sheet is
    // said by the import-again sentence (desktop _mark_revisions_changed).
    const pend = new Set((this.md.revisions_pending_images || [])
      .filter(q => q && typeof q === 'object').map(q => String(q.id)));
    if (pend.size) {
      const bk = this.md.sheet_version || {};
      said = said.filter(([page, wid]) => {
        if (pend.has(String(bk[String(page)] || ''))) return false;
        const others = new Set(this.items(page).filter(isTakeoffType).map(itemRevId));
        others.delete(wid);
        return ![...others].every(r => pend.has(r));
      });
      if (!said.length) return '';
    }
    const bits = [];
    for (const [page, wid, emptied] of said.slice(0, 3)) {
      const rids = [...new Set(this.items(page).filter(isTakeoffType).map(itemRevId))]
        .filter(r => r !== wid)
        .sort((a, b) => ((this.revisionNumber(a) || 0) - (this.revisionNumber(b) || 0))
          || (a < b ? -1 : a > b ? 1 : 0));
      const others = rids.map(r => `${this.versionName(r)} (${
        takeoffQuantityWords(this.items(page).filter(m => isTakeoffType(m) && itemRevId(m) === r))
        || amountWords(...this.takeoffAmount(page, r))})`);
      if (emptied) {
        bits.push(`${this.pageLabel(page)}: nothing is left on ${this.versionName(wid)}, the drawing it `
          + `counts from, so it adds nothing to your totals now. The takeoff on ${others.join(', ')} is `
          + 'not counted — open that drawing and press Count this version to count it');
      } else {
        bits.push(`${this.pageLabel(page)}: the takeoff on ${others.join(', ')} is back, and it is NOT `
          + `counted — the sheet counts from ${this.versionName(wid)}, which holds nothing. Open that `
          + 'drawing and press Count this version to count it');
      }
    }
    if (said.length > 3) bits.push(`and ${said.length - 3} more sheets the same`);
    return `${bits.join('. ')}.`;
  }

  // ── the Pages list's tiles ─────────────────────────────────────────

  /**
   * {page: {kind, text, short, added, shows, tip}} for every tile that says
   * something (desktop _sheet_tile_states): REV n when a revision superseded
   * the sheet, ADDED when a revision brought it, ⚠ when the takeoff counts
   * from a drawing other than the one shown. All of it is LOOKING.
   */
  sheetTileStates() {
    const out = {};
    if (!this.n) return out;
    const origin = this.originMap();
    if (!this.revs.length && !Object.keys(origin).length) return out;
    const known = new Set(this.revs.map(r => String(r.id)));
    for (let i = 0; i < this.n; i++) {
      const org = origin[String(i)] || null;
      const vers = this.sheetVersions(i);
      const shown = vers.length > 1 ? this.newestVersionOf(i) : '';
      const counted = this.workingVersionOf(i);
      // Takeoff by the drawing it was traced on (takeoffOnDrawings): a piece
      // whose page is no drawing of this sheet now is on no version of it —
      // it waits, and the tip says so apart.
      const { byRev, waiting } = this.takeoffOnDrawings(i);
      const raw = new Map();
      for (const [rid, [a, b]] of byRev) {
        if (a + b) raw.set(rid, a + b);
      }
      const warn = raw.size > 0 && counted !== shown;
      if (!(shown || org || warn)) continue;
      let shows = null;
      if (shown) {
        const hit = vers.find(v => v.revId === shown);
        if (hit && hit.revPage >= 0 && hit.revPage < revPageCount(hit.rev)) shows = [shown, hit.revPage];
      }
      const tag = shown ? this.revTag(shown) : '';
      const no = shown ? this.revisionNumber(shown) : 0;
      const stag = (tag && [...tag].length <= 5 && !tag.startsWith('REV '))
        ? tag : (no ? `R${no}` : [...tag].slice(0, 3).join(''));
      let kind, text, short;
      if (warn) {
        kind = 'warn';
        text = `⚠ ${tag || (org ? 'ADDED' : 'ORIG')}`;
        short = `⚠${stag || (org ? '◆' : '')}`;
      } else if (org) {
        kind = 'added';
        text = shown ? `◆ ${tag}` : 'ADDED';
        short = `◆${stag}`;
      } else {
        kind = 'rev'; text = tag; short = stag;
      }
      out[i] = { kind, text, short, added: org !== null, shows,
        tip: this.sheetTileTip(i, vers, shown, counted, org, raw, warn, known, waiting) };
    }
    return out;
  }

  sheetTileTip(page, vers, shown, counted, org, raw, warn, known, waiting = [0, 0]) {
    const nm = this.pageLabel(page);
    const lines = [];
    if (org) {
      const [rid, rp, date] = org;
      const src = known.has(rid) ? this.revTitle(rid)
        : `a revision since deleted${date ? `, dated ${date}` : ''}`;
      lines.push(`ADDED — not part of the original plans. ${nm} came with ${src}, as page ${rp + 1} of that set.`);
    }
    if (shown) {
      lines.push(org
        ? `Reissued since: the list shows ${this.revTitle(shown)}, the newest of the ${vers.length} drawings of this sheet.`
        : `REVISED — the list shows ${this.revTitle(shown)}, the newest of the ${vers.length} drawings of this sheet.`);
    }
    let own;
    if (!org) own = 'its own drawing (the original set)';
    else if (known.has(org[0])) own = `its own drawing (it came with ${this.revTag(org[0])})`;
    else own = 'its own drawing';
    const where = rid => (!rid ? own : (known.has(rid) ? this.revTitle(rid) : 'a revision since removed'));
    const items = this.itemsByVersion(page);
    const amount = rid => {
      const nIt = items.get(rid) || 0;
      const runs = (raw.get(rid) || 0) - nIt;
      const bits = [];
      if (nIt) bits.push(`${nIt} item${nIt === 1 ? '' : 's'}`);
      if (runs > 0) bits.push(`${runs} shape${runs === 1 ? '' : 's'} of items that span sheets`);
      return bits.join(' and ') || 'nothing';
    };
    const w = waiting || [0, 0];
    const nWait = (w[0] || 0) + (w[1] || 0);
    if (!raw.size) {
      lines.push(nWait ? 'Nothing taken off any drawing of this sheet.'
        : 'Nothing taken off this sheet yet.');
    } else {
      lines.push(`Counting: ${where(counted)} — ${raw.get(counted) ? amount(counted) : 'nothing is taken off it'}.`);
      const others = [...raw.keys()].filter(r => r !== counted)
        .sort((a, b) => ((this.revisionNumber(a) || 1e6) - (this.revisionNumber(b) || 1e6))
          || (a < b ? -1 : a > b ? 1 : 0));
      for (const rid of others.slice(0, 4)) lines.push(`Not counted: ${amount(rid)} on ${where(rid)}.`);
      if (others.length > 4) lines.push(`…and takeoff on ${others.length - 4} more drawings, not counted.`);
    }
    if (nWait) {
      lines.push(`Waiting: ${amountWords(w[0] || 0, w[1] || 0)}, traced on a page that is no drawing of this sheet now — it counts nowhere until that page is placed.`);
    }
    if (warn) {
      const how = (shown && !this.versionTakeoffSizeOk(page, shown))
        ? "The drawing shown is another sheet size, so it cannot be taken off here: the scale belongs to the sheet's own drawing."
        : 'To count the drawing shown instead, open the sheet and press Count this version on the version bar — you are shown the change before it is made.';
      lines.push(`⚠ What counts is not the drawing shown. Nothing in your totals has changed. ${how}`);
    }
    return lines.join('\n');
  }

  // ── the report's closing tables ─────────────────────────────────────

  /**
   * [[page, countedRevId, Map{revId: [items not counted]}]] for every sheet
   * holding takeoff on a version that does not count (desktop
   * ReportCenterDialog._counted_book). `listsRow(m)` says whether the report
   * lists this type at all (the ruler only with dimensions included).
   */
  countedBook(listsRow = () => true) {
    const out = [];
    const keys = this.pageKeys().filter(k => k >= 0).sort((a, b) => a - b);
    for (const pg of keys) {
      const left = new Map();
      let countedRid = '';
      for (const m of this.items(pg)) {
        if (!m || ['textnote', 'page_ref', 'pitch', 'group', 'ref_distance'].includes(m.type)) continue;
        if (!listsRow(m)) continue;
        const rid = String(m.rev_id || '');
        if (this.runCountsTowards(pg, m)) {
          if (!truthy(m.group_child)) countedRid = rid;
        } else if (this.waitingReason(pg, m, true)) {
          continue;
        } else {
          if (!left.has(rid)) left.set(rid, []);
          left.get(rid).push(m);
        }
      }
      if (left.size) out.push([pg, countedRid, left]);
    }
    return out;
  }

  /**
   * [[page, revId]] for every sheet whose takeoff in the totals was traced
   * on a revision drawing (desktop ReportCenterDialog._counted_from) —
   * wherever its other drawings stand, so a sheet the first takeoff booked
   * is named too.
   */
  countedFrom(listsRow = () => true) {
    const out = [];
    const keys = this.pageKeys().filter(k => k >= 0).sort((a, b) => a - b);
    for (const pg of keys) {
      const rids = [];
      for (const m of this.items(pg)) {
        if (!m || ['textnote', 'page_ref', 'pitch', 'group', 'ref_distance'].includes(m.type)) continue;
        if (!listsRow(m)) continue;
        const rid = String(m.rev_id || '');
        if (rid && !rids.includes(rid) && this.runCountsTowards(pg, m)) rids.push(rid);
      }
      for (const rid of rids) out.push([pg, rid]);
    }
    return out;
  }

  /** [[page, item, where]] for takeoff counted NOWHERE (_waiting_book). */
  waitingBook(listsRow = () => true) {
    const out = [];
    const keys = this.pageKeys().filter(k => k >= 0).sort((a, b) => a - b);
    for (const pg of keys) {
      for (const m of this.items(pg)) {
        if (!m || ['textnote', 'page_ref', 'pitch', 'group', 'ref_distance'].includes(m.type)) continue;
        if (!listsRow(m)) continue;
        const why = this.waitingReason(pg, m, true);
        if (why) out.push([pg, m, why]);
      }
    }
    return out;
  }

  // ── the Current Set, with promoted sheets ranked as what they are ──

  latestSheets({ includeNew = true, excludeIds = null } = {}) {
    const labels = Array.from({ length: this.n }, (_, i) => this.pageLabel(i));
    return resolveLatestSheets(labels, this.md.extra_sheets || [], this.visibleRevisions(),
      { order: this.order, includeNew, origins: this.originMap(),
        names: this.revisionNames(), excludeIds });
  }
}

/**
 * Write a booking into the metadata (the desktop's set_working_version, the
 * writing half). Called inside the transaction of the takeoff that caused it,
 * so an undo of that takeoff takes the booking back with it.
 */
export function applyBooking(md, change) {
  if (!change) return;
  if (change.book) md.sheet_version = { ...change.book };
  else delete md.sheet_version;
  if (change.bookedOver) {
    const { revId, revPage, was } = change.bookedOver;
    const rev = (md.revisions || []).find(r => String(r.id) === revId);
    if (rev) {
      rev.booked_over = { ...(rev.booked_over || {}) };
      rev.booked_over[String(revPage)] = was;
    }
  }
}

/**
 * The question the Items list's Delete asks, and the line said after a Yes
 * (desktop PDFCacheViewer._on_item_delete with the list not on one sheet, or
 * with every shape of the item on the drawing on screen -- otherwise the
 * SHEET chip's three-way question is asked: deleteHereChoice). Asked of
 * every item, one shape or many; the second paragraph only when the item is
 * more than one shape. Yes / No, and No is the default.
 */
export function deleteItemQuestion(m) {
  const it = m || {};
  const name = deleteName(it);
  const n = truthy(it.group_count) ? it.group_count : 1;
  const extra = Number(n) > 1 ? `\n\nThis removes all ${n} shapes that make up the item.` : '';
  return {
    title: 'Delete Item',
    text: `Delete “${name}”?${extra}`,
    buttons: ['Yes', 'No'],
    defaultButton: 'No',
    done: `Deleted “${name}”.`,
  };
}

/** Python's `"%s" % x` for the quantity cell of a report's closing table. */
export function valueLine(m) {
  const t = (m || {}).type || '';
  const v = orZero(m.value);
  if (t === 'count') return `${(m.points || []).length} EA`;
  if (['area', 'grid', 'tile', 'slope_area'].includes(t)) {
    const f = pyFloat(v);
    return `${f.ok ? pyFixed(f.n, 1, true) : '0.0'} sq ft`;
  }
  if (t === 'distance' || t === 'polyline') {
    const f = pyFloat(v);
    return `${f.ok ? pyFixed(f.n, 2, true) : '0.00'} LF`;
  }
  if (t === 'standalone') {
    const f = pyFloat(orZero(m.qty));
    return `${pyG(f.ok ? f.n : 0)} ${m.unit || 'each'}`;
  }
  return '1 EA';
}

// ── one sheet: the Items list's SHEET chip (desktop TakeoffItemsPanel) ──
//
// The list shows the items with a shape PAINTED on the drawing on screen --
// the sheet's own, or the revision of it that is up -- because work on any
// other drawing is not painted there (onThisVersion), and an item listed
// under a sheet it cannot be seen on is one he hunts for. A row is still one
// item: it says what is drawn HERE, and the item's whole total beside it
// when that differs. Items on no sheet wait in a section at the bottom. The
// floor and group filters stay the job's.
//
// Each function below is the desktop method of the same name, line for
// line; tests/revision-counting.mjs holds them to the desktop's own methods,
// lifted by text, word for word. `view` is the drawing on screen:
// {page, revId, revPage} -- revId '' and revPage null for the sheet's own.

/** What the list has never shown as a row: readings, notes, callouts
 *  (desktop TakeoffItemsPanel._NOT_ROWS). */
export const NOT_ROWS = new Set(['distance', 'textnote', 'page_ref', 'pitch', 'ref_distance']);

function isGroupItem(m) {
  return !!m && typeof m === 'object' && m.type === 'group';
}

function isStandaloneItem(m) {
  return !!m && typeof m === 'object' && m.type === 'standalone';
}

/** Python's str(x or ""). */
function strOr(v) {
  return truthy(v) ? pyStr(v) : '';
}

/**
 * What the list shows on one sheet, out of the rows the other filters left
 * (`all`, [[page, item]]) -- desktop _sheet_rows:
 *
 *   rows   -- the items with a shape painted here: a main shape on this
 *             sheet, or the main shape of a run on it, wherever that lives;
 *             and each Group one of them is in (the web lists no Group, so
 *             `all` never holds one -- kept for the desktop's arithmetic);
 *   solo   -- the items on no sheet;
 *   here   -- Map {item: [its shapes painted here]};
 *   pages, shapes -- Map {group_id: Set of its sheets}, {group_id: its shapes};
 *   hidden -- what the chip leaves out, BY ITEM: on another drawing of this
 *             sheet only, waiting on no drawing, or on other sheets;
 *   filtered -- how many items painted here the cost, floor and group
 *             filters took out, BY ITEM.
 *
 * One pass over the job for the main shapes -- never a measurementGroup per
 * row, which walks the whole job each time.
 */
export function sheetRows(model, all, view) {
  const cur = view.page;
  const masters = new Map();
  const pages = new Map();
  const shapes = new Map();
  for (const key of Object.keys(model.meas)) {
    const pg = Number(key);
    for (const m of model.meas[key] || []) {
      const gid = m.group_id;
      if (!truthy(gid)) continue;
      shapes.set(gid, (shapes.get(gid) || 0) + 1);
      if (pg !== STANDALONE) {
        if (!pages.has(gid)) pages.set(gid, new Set());
        pages.get(gid).add(pg);
      }
      if (!truthy(m.group_child) && !masters.has(gid)) masters.set(gid, m);
    }
  }
  const here = new Map();
  const other = new Set();
  const waits = new Set();
  const markOf = s => model.markVersion(cur, s);
  for (const m of model.items(cur)) {
    if (NOT_ROWS.has(m.type)) continue;
    let item = m;
    if (truthy(m.group_child)) {
      item = masters.get(m.group_id);
      if (item === undefined) continue;
    }
    if (onThisVersion(m, view.revId, view.revPage, markOf)) {
      if (!here.has(item)) here.set(item, []);
      here.get(item).push(m);
    } else if (model.waitingReason(cur, m)) {
      waits.add(item);
    } else {
      other.add(item);
    }
  }
  const rows = all.filter(([, m]) => here.has(m));
  const boxes = new Set(rows.map(([, m]) => strOr(m.in_group)).filter(Boolean));
  for (const r of all) {
    if (isGroupItem(r[1]) && boxes.has(strOr(r[1].group_item_id))) rows.push(r);
  }
  const solo = all.filter(([pg, m]) => pg === STANDALONE && !isGroupItem(m));
  const hidden = { drawings: 0, waiting: 0, sheets: 0 };
  for (const [pg, m] of all) {
    if (here.has(m) || pg === STANDALONE || isGroupItem(m)) continue;
    if (other.has(m)) hidden.drawings += 1;
    else if (waits.has(m)) hidden.waiting += 1;
    else hidden.sheets += 1;
  }
  // Painted here, but taken out by the other filters: an empty list must
  // not read as an empty drawing.
  const listed = new Set(all.map(([, m]) => m));
  let filtered = 0;
  for (const k of here.keys()) if (!listed.has(k)) filtered += 1;
  return { rows, solo, here, pages, shapes, hidden, filtered };
}

/** '3 on other drawings of this sheet', '240 on other sheets', '2 waiting
 *  on no drawing': what the chip leaves out, by item (desktop _hidden_words). */
export function hiddenWords(hidden) {
  const d = (hidden && hidden.drawings) || 0;
  const s = (hidden && hidden.sheets) || 0;
  const w = (hidden && hidden.waiting) || 0;
  const out = [];
  if (d) out.push(`${d} on ${d === 1 ? 'another drawing' : 'other drawings'} of this sheet`);
  if (s) out.push(`${s} on ${s === 1 ? 'another sheet' : 'other sheets'}`);
  if (w) out.push(`${w} waiting on no drawing`);
  return out;
}

/** desktop TakeoffItemsPanel._n: '1 item', '2 items'. */
export function nWords(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** The list's title (desktop _title_for): a long sheet name is cut at 12,
 *  and said whole in sheetTip. */
export function sheetTitle(sheet) {
  if (!sheet) return 'PROJECT ITEMS';
  const cps = [...String(sheet)];
  const short = cps.length <= 12 ? String(sheet) : `${cps.slice(0, 11).join('')}…`;
  return `ITEMS ON ${short.toUpperCase()}`;
}

/** The title's tooltip -- and, for a finger, what a tap on it says. */
export function sheetTip(sheet) {
  return sheet ? `Only the items drawn on ${sheet} — the SHEET chip shows them all again` : '';
}

/**
 * What the SHEET chip leaves out, said, never just missing (desktop refresh):
 * {top, footer}. `top` (the list's only line) when nothing listed is drawn
 * here; otherwise `footer`, 'Not shown: ...', under this sheet's rows --
 * above NOT ON A SHEET when that section is listed, else at the end.
 */
export function sheetNotes(sheet, label) {
  const words = hiddenWords(sheet.hidden);
  if (!sheet.rows.length) {
    const nHid = sheet.filtered;
    if (nHid) {
      // Takeoff IS drawn here: the filters are hiding it. What they let
      // through elsewhere is still said after it.
      return { top: `Nothing on ${label} (this drawing) matches the filters — `
        + `${nWords(nHid, 'item')} here ${nHid === 1 ? 'is' : 'are'} hidden by them`
        + (words.length ? `; ${words.join(', ')}` : ''), footer: null };
    }
    return { top: `Nothing on ${label} (this drawing)`
      + (words.length ? ` — ${words.join(', ')}` : ''), footer: null };
  }
  return { top: null, footer: words.length ? `Not shown: ${words.join(', ')}` : null };
}

/** Python's "%d" % int(round(q)): round half to even, then the digits. */
function intRound(q) {
  return pyIntStr(pyRound(Number(q) || 0, 0));
}

/** Python's "%d" % int(q). */
function intTrunc(q) {
  return pyIntStr(Number(q) || 0);
}

/** A quantity in the words a row of this kind already uses (desktop
 *  _qty_words): Python's rounding, a .x5 tie to even. */
export function qtyWords(m, q) {
  const t = (m && m.type) || '';
  if (t === 'count') return `× ${intRound(q)}`;
  if (t === 'distance' || t === 'polyline') return `${pyFixed(q, 2)} ft`;
  if (t === 'linear_count') return `${intTrunc(q)} items`;
  if (t === 'area' || t === 'slope_area' || t === 'grid' || t === 'tile') return `${pyFixed(q, 1)} sq ft`;
  return takeoffQtyText(q, takeoffQty(m)[1]);
}

/** desktop TILE_PATTERNS / _tile_pattern_label: an unknown key is itself. */
const TILE_LABELS = {
  grid: 'Straight Grid', half: 'Running Bond ½', third: 'Stair-Step ⅓',
  herringbone: 'Herringbone', chevron: 'Chevron', diagonal: 'Diagonal 45°',
};
function tileLabel(pattern) {
  return Object.prototype.hasOwnProperty.call(TILE_LABELS, pattern) ? TILE_LABELS[pattern] : pattern;
}

/** desktop PIN_KINDS / pin_prefix. */
const PIN_PREFIX = { window: 'win_', door: 'door_', partition: 'part_', header: 'hdr_' };

/** Python's m.get(k, d). */
function getOr(m, k, d) {
  return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : d;
}

/**
 * A row's quantity line in the desktop's own words (TakeoffItemsPanel.
 * _value_str), with its rounding: what a row the SHEET chip finds wholly on
 * the drawing on screen, and counted, reads -- exactly as the desktop's full
 * list reads it.
 */
export function valueStr(m) {
  const t = m.type || '';
  if (t === 'standalone') {
    const q = orZero(m.qty);
    const u = String(truthy(m.unit) ? m.unit : 'each').trim();
    return truthy(q) ? `${pyG(Number(q))} ${u}` : 'no quantity yet — double-click to set';
  }
  const parts = [];
  const nShapes = getOr(m, 'group_count', 1);
  if (nShapes > 1) parts.push(`total of ${pyStr(nShapes)} shapes`);
  const sc = strOr(m.scale).trim();
  if (sc) parts.push(`${sc} scale`);
  const suffix = parts.length ? `   ·  ${parts.join('  ·  ')}` : '';
  const v = orZero(m.value);
  if (t === 'area' || t === 'grid') return truthy(v) ? `${pyFixed(Number(v), 1)} sq ft${suffix}` : '';
  if (t === 'slope_area') {
    return truthy(v) ? `${pyFixed(Number(v), 1)} sq ft (${pyG(Number(getOr(m, 'pitch', 0)))}:12)${suffix}` : '';
  }
  if (t === 'tile') {
    const needed = Math.trunc(Number(getOr(m, 'tiles_needed', 0)) || 0);
    const pat = tileLabel(getOr(m, 'pattern', 'grid'));
    let out = `${pyFixed(Number(v), 1)} sq ft · ${pyIntStr(needed, true)} tiles (${pat})`;
    if (truthy(m.boxes)) out += ` · ${pyStr(m.boxes)} boxes`;
    return truthy(v) ? out + suffix : '';
  }
  if (t === 'distance' || t === 'polyline') return truthy(v) ? `${pyFixed(Number(v), 2)} ft${suffix}` : '';
  if (Object.prototype.hasOwnProperty.call(PIN_PREFIX, t)) {
    const p = PIN_PREFIX[t];
    const tag = getOr(m, `${p}number`, '');
    if (t === 'partition') return truthy(tag) ? pyStr(tag) : 'partition into a wall';
    if (t === 'header') {
      const sz = strOr(getOr(m, 'hdr_size', ''));
      const spn = strOr(getOr(m, 'hdr_width', ''));
      const bits = [tag, sz && sz !== 'auto' ? sz : '', spn ? `span ${spn}` : ''].filter(truthy);
      return bits.length ? bits.map(pyStr).join('  ') : 'sized from the wall — double-click to edit';
    }
    const w = getOr(m, `${p}width`, '');
    const h = getOr(m, `${p}height`, '');
    if (truthy(w) || truthy(h)) return `${truthy(tag) ? `${tag}  ` : ''}${pyStr(w)} × ${pyStr(h)}`.trim();
    return truthy(tag) ? pyStr(tag) : 'no size yet — double-click to edit';
  }
  if (t === 'linear_count') {
    const n = intTrunc(orZero(m.value));
    return `${n} items @ ${pyG(Number(getOr(m, 'spacing_in', 12)))}"${suffix}`;
  }
  if (t === 'count') {
    const cnt = (m.points || []).length;
    return cnt ? `× ${cnt}` : '';
  }
  return '';
}

/** Whether the takeoff painted here is in the totals: its runs, on the
 *  drawing on screen (desktop _counts_here). */
export function countsHere(model, page, here) {
  return (here || []).some(s => model.runCountsTowards(page, s));
}

/**
 * A row while the list shows one sheet (desktop _sheet_value_str): the
 * takeoff painted HERE, run by run the way the totals add it up (a count is
 * its points), and '   ·  48.0 sq ft in all' when the item's total is
 * something else, or when what is here is not what counts. An item that is
 * all here, and counts, reads exactly as the full list reads it (valueStr).
 * `shapesOf` is sheetRows' `shapes`.
 */
export function sheetValueStr(model, pageIdx, m, here, counted, shapesOf) {
  let q = 0.0;
  for (const s of here) q += takeoffShapeQty(s)[0];
  const gid = m.group_id;
  const whole = here.length >= (truthy(gid) ? (shapesOf.get(gid) || 1) : 1);
  // desktop _total_of: the item's total, None when it is in none
  const tot = model.itemCountsTowards(pageIdx, m) ? model.countedQty(pageIdx, m) : null;
  const differs = tot !== null && (Math.abs(tot[0] - q) > 1e-6 || !counted);
  if (whole && !differs) return valueStr(m);
  let txt = qtyWords(m, q);
  if (differs) {
    const allTxt = m.type === 'count' ? intRound(tot[0]) : qtyWords(m, tot[0]);
    txt += `   ·  ${allTxt} in all`;
  }
  return txt;
}

/** The other sheets an item has shapes on, besides its own page (desktop
 *  _also_on), in page order. `pagesOf` is sheetRows' `pages`. */
export function alsoOn(pagesOf, pageIdx, m) {
  const gid = m.group_id;
  if (!truthy(gid)) return [];
  return [...(pagesOf.get(gid) || [])].filter(p => p !== pageIdx).sort((a, b) => a - b);
}

/**
 * The sheet label of a row the list shows on one sheet, and its tooltip --
 * desktop _item_row's page_hint, for a row with shapes painted here:
 * {text: 'X1.0 +2', tip, also: [pages], counts, chip}. `chip` is the
 * desktop's red '⊘ REV 2' / '⊘ own' word (the web shows its NOT COUNTED tag
 * instead); '' when the takeoff here counts.
 */
export function sheetPageWords(model, pageIdx, m, here, countedHere, pagesOf) {
  let text = model.pageLabel(pageIdx);
  const also = here ? alsoOn(pagesOf, pageIdx, m) : [];
  let alsoTip = '';
  if (also.length) {
    text += ` +${also.length}`;
    alsoTip = ` — also on ${also.map(p => model.pageLabel(p)).join(', ')}`;
  }
  let tip = `Page ${pageIdx + 1}${alsoTip}`;
  const s = here && here.length ? here[0] : m;
  const rid = strOr(s && s.rev_id);
  let revTxt = rid ? (model.revisionLabel(rid) || 'revision') : '';
  const counts = here && here.length ? !!countedHere : model.itemCountsTowards(pageIdx, m);
  if (here && here.length && counts) revTxt = '';
  let chip = '';
  if (revTxt || !counts) {
    chip = revTxt || 'own';
    if (!counts) chip = `⊘ ${chip}`;
    const why = counts ? '' : model.waitingReason(pageIdx, m);
    tip = `Page ${pageIdx + 1}${alsoTip} — taken off on ${revTxt || 'the sheet’s own drawing'}`
      + (counts ? '' : (why ? `.\n⊘ NOT COUNTED — ${why}.`
        : '.\n⊘ NOT COUNTED — this sheet counts from another of its versions, so this item '
          + 'is not in the totals. The version bar at the top of the Pages panel is where that changes.'));
  }
  return { text, tip, also, counts, chip, revTxt };
}

/**
 * Why the takeoff painted here is not counted, in the web's words (the
 * web's NOT COUNTED tag, which stands for the desktop's red chip). Unlike the
 * desktop's tooltip it never says an item counted from its shapes on other
 * sheets is out of the totals.
 */
export function notCountedHereWhy(model, page, pageIdx, m, here) {
  const s = here[0];
  const waiting = model.waitingReason(page, s);
  const reason = waiting || `taken off on ${model.versionName(itemRevId(s))}; `
    + `${model.pageLabel(page)} counts from ${model.versionName(model.workingVersionOf(page))}`;
  return `NOT COUNTED from this drawing — ${reason}. `
    + (model.itemCountsTowards(pageIdx, m)
      ? 'The item is in your totals from its shapes on other drawings.'
      : 'It is kept, and it is not in your totals or any report.');
}

/** How many items there are on no sheet (desktop _open_solo_on_add's
 *  count): one more than at the last build opens NOT ON A SHEET. */
export function soloCount(measurements) {
  return ((measurements && (measurements[STANDALONE] || measurements[String(STANDALONE)])) || [])
    .filter(isStandaloneItem).length;
}

/** The shapes of one item painted on the drawing on screen (desktop
 *  _shapes_on_screen), master first, then by sheet. */
export function shapesOnScreen(model, view, pageIdx, m) {
  const cur = view.page;
  const gid = m.group_id;
  const shapes = truthy(gid) ? model.measurementGroup(gid) : [[pageIdx, m]];
  const markOf = s => model.markVersion(cur, s);
  return shapes.filter(([pg, s]) => pg === cur && onThisVersion(s, view.revId, view.revPage, markOf))
    .map(([, s]) => s);
}

/** The name an item's Delete speaks of (desktop _on_item_delete). */
export function deleteName(m) {
  const it = m || {};
  return String(truthy(it.name) ? it.name : truthy(it.label) ? it.label : 'this item').trim();
}

/**
 * Delete from the Items list while it shows one sheet (desktop
 * _ask_delete_here). null when it does not, when the item is one shape, or
 * when every shape of it is on the drawing on screen: deleteItemQuestion
 * asks then. Otherwise the question, with both answers named in full --
 * {title, text, info, buttons: [here, whole, 'Cancel'], defaultButton:
 * 'Cancel', local: [the shapes painted here], where: this sheet's name,
 * rest: where the rest of the item is}.
 */
export function deleteHereChoice(model, view, pageIdx, m, name, sheetOnly = true) {
  const gid = m.group_id;
  if (!truthy(gid) || !sheetOnly) return null;
  const cur = view.page;
  const shapes = model.measurementGroup(gid);
  const local = shapesOnScreen(model, view, pageIdx, m);
  if (!local.length || local.length >= shapes.length) return null;
  const mine = new Set(local);
  const pages = [...new Set(shapes.map(([pg]) => pg).filter(pg => Number.isInteger(pg) && pg >= 0))]
    .sort((a, b) => a - b);
  const names = pgs => {
    const lbls = pgs.map(p => model.pageLabel(p));
    return lbls.length > 4 ? `${lbls.slice(0, 4).join(', ')} and ${lbls.length - 4} more` : lbls.join(', ');
  };
  let here = model.pageLabel(cur);
  if (shapes.some(([pg, s]) => pg === cur && !mine.has(s))) here += ' (this drawing)';
  const others = pages.filter(p => p !== cur);
  const rest = others.length ? names(others) : 'another drawing of this sheet';
  return {
    title: 'Delete Item',
    text: `“${name}” has ${shapes.length} shapes, on ${names(pages)}.`,
    info: `The list is showing ${here}. Delete only what is drawn there, or the whole item?`,
    buttons: [
      `Delete the ${local.length === 1 ? 'shape' : `${local.length} shapes`} on ${here}`,
      `Delete the whole item (${shapes.length} shapes on ${names(pages)})`,
      'Cancel',
    ],
    defaultButton: 'Cancel',
    local, where: here, rest,
  };
}

/** What the status line says after 'this sheet' (desktop _on_item_delete). */
export function deletedHereWords(n, name, where, rest) {
  return `Deleted ${n === 1 ? 'the shape' : `${n} shapes`} of “${name}” on ${where} — it is still on ${rest}`;
}

/**
 * A tap on a row while the list shows one sheet (desktop
 * _activate_on_this_sheet, which a double-click runs there): walk the item's
 * shapes on the drawing on screen, and only those -- turning the page would
 * swap the whole list out from under the row. null when nothing of the item
 * is painted here (the ordinary jump runs then). `cycle` is the window's
 * {key, idx} (desktop _shape_cycle_gid / _shape_cycle_idx), kept by the
 * caller; another drawing starts again at shape 1. `verb` is the gesture
 * the status line names ('double-click' on the desktop).
 */
export function activateOnThisSheet(model, view, pageIdx, m, cycle, verb = 'double-click') {
  const local = shapesOnScreen(model, view, pageIdx, m);
  if (!local.length) return null;
  let idx = 0;
  let said = '';
  let next = cycle || null;
  if (local.length > 1) {
    const key = JSON.stringify(['sheet', m.group_id === undefined ? null : m.group_id, view.page,
      view.revId ? [String(view.revId), view.revPage === undefined ? null : view.revPage] : null]);
    if (cycle && cycle.key === key) idx = (cycle.idx + 1) % local.length;
    next = { key, idx };
    said = `Shape ${idx + 1} of ${local.length} on ${model.pageLabel(view.page)} — ${verb} the item `
      + 'again for the next shape';
  }
  return { target: local[idx], idx, n: local.length, cycle: next, said };
}

/**
 * A tap on a row with the list not on one sheet, or nothing of the item
 * here (desktop _on_item_activated): a multi-shape item cycles through its
 * shapes ACROSS sheets, master first, one per tap. {target: [page, shape],
 * cycle, said}.
 */
export function activateAcrossSheets(model, pageIdx, m, cycle, verb = 'double-click') {
  let target = [pageIdx, m];
  let said = '';
  let next = cycle || null;
  const gid = m.group_id;
  if (truthy(gid)) {
    const shapes = model.measurementGroup(gid);
    if (shapes.length > 1) {
      const key = JSON.stringify(['item', gid]);
      const idx = cycle && cycle.key === key ? (cycle.idx + 1) % shapes.length : 0;
      next = { key, idx };
      target = shapes[idx];
      said = `Shape ${idx + 1} of ${shapes.length} — ${verb} the item again for the next shape`;
    }
  }
  return { target, cycle: next, said };
}

/** Properties… on a row while the list shows one sheet (desktop
 *  _properties_on_this_sheet): the shape to select before the form opens --
 *  the main shape when it is painted here, else the first shape here -- or
 *  null when nothing of the item is here (the ordinary path runs then). */
export function propertiesOnThisSheet(model, view, pageIdx, m) {
  const local = shapesOnScreen(model, view, pageIdx, m);
  if (!local.length) return null;
  return local.includes(m) ? m : local[0];
}

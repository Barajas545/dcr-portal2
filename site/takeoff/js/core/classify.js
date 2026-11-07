// classify.js -- floor levels, categories and sub-categories, as the desktop
// names, sorts and offers them.
//
// A floor level, a category and a sub-category are nothing but strings on
// the items (and on the material lines that carry their own). A heading in
// the Items list is not a thing of its own either: it is the string its rows
// share. This module holds the few rules every place that names one shares,
// ported line for line from pdf_fast_viewer.py 3.07 and held to the lifted
// desktop functions by tests/heading-menu.mjs (tests/rename-python-truth.py):
//
//   * classClean / classNorm / classSortKey     _class_clean / _class_norm /
//                                               _class_sort_key (L313-328)
//   * projectValues                             GLPageWidget.project_values
//   * classChoicesFrom                          _fill_class_combo (L360-374)
//   * headerAct / headerTip                     TakeoffItemsPanel._header_act
//                                               / _header_tip (L51127-51162)
//   * rowsUnder                                 TakeoffItemsPanel._rows_under
//   * rowsNow                                   the web's own: the desktop's
//                                               menu is modal, so the rows
//                                               its meta carries cannot go
//                                               stale under it
//
// and, for renaming a heading and filing the items under a blank one (3.07,
// Round 7; held to the lifted desktop by tests/classification-rename.mjs):
//
//   * CLASS_RESERVED / ENGINE_CATEGORIES /      the module's (L299-339)
//     classNameProblem
//   * isClassRow / classificationPlan /         GLPageWidget (L44994-45450):
//     planCounts / unfiledItems / assignPlan    _class_is_row,
//     renameClassification /                    classification_plan,
//     assignClassification                      _plan_counts, unfiled_items,
//                                               rename_classification,
//                                               assign_classification
//   * classToolNow / classToolMoved /           _class_tool_now / _moved /
//     followClassification / applyClassTool     _follow_classification /
//                                               _undo_class_tool
//   * pinStock / pinFiling / setPinFiling /     _pin_stock / _pin_filing /
//     followPinFiling                           _set_pin_filing /
//                                               _follow_pin_filing (L37035)
//   * nOf / amountWords / existingSpelling /    TakeoffItemsPanel._n /
//     renameWhat / renameNotes / mergeQuestion  _amount / _existing_spelling
//     / renameSaid / followRename / assignWhat  and the sentences of
//     / assignOptions / assignSaid              _rename_from_header,
//                                               _follow_rename,
//                                               _assign_from_header
//
// Pure: no DOM. The store is handed in -- and for the two writes, the
// Project (its transact, its undo level, its 'items-changed').

import { isTakeoffType } from './revisions.js';

/** The three fields a heading can be (GLPageWidget.CLASS_FIELDS). */
export const CLASS_FIELDS = Object.freeze(['floor_level', 'category', 'sub_category']);

// Python's str.split() and str.strip() take these as whitespace. JS's \s
// also takes U+FEFF and leaves out \x1c-\x1f, so a name with either in it
// would clean differently -- spelled out instead.
const PY_WS_CHARS = ' \\t\\n\\r\\x0b\\x0c\\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_WS = new RegExp(`[${PY_WS_CHARS}]+`);
const PY_EDGE_WS = new RegExp(`^[${PY_WS_CHARS}]+|[${PY_WS_CHARS}]+$`, 'g');

/** Python's `str(x or "")`: 0, false, null and '' are all blank. */
const pyStr = v => (v ? String(v) : '');
/** Python's `str.strip()`. */
const pyStrip = s => s.replace(PY_EDGE_WS, '');
const isDict = v => !!v && typeof v === 'object' && !Array.isArray(v);

/** A name as it is kept: no leading or trailing spaces, one space where he
 *  typed two. */
export function classClean(s) {
  return pyStr(s).split(PY_WS).filter(Boolean).join(' ');
}

// Python's casefold() out of JS's own full case mappings: up, then down --
// the UPPER mappings are the ones that spell 'ß' as 'SS', 'ﬃ' as 'FFI' and
// 'ᾳ' as 'ΑΙ' -- then the places the two still part: a final sigma is a
// sigma, the capital sharp s folds to 'ss', the dotless i stays itself
// (upper-cased it would come back a dotted one), and Cherokee folds to its
// CAPITALS. Held, character by character, to the desktop's own _class_norm
// for every character both Unicode tables know (tests/classification-
// rename.mjs, section 1).
const CHEROKEE_SMALL = /[ᏸ-ᏽꭰ-ꮿ]/g;
const cherokeeCap = c => {
  const cp = c.charCodeAt(0);
  return String.fromCharCode(cp >= 0xAB70 ? cp - 0xAB70 + 0x13A0 : cp - 8);
};
const pyCasefold = s => s.split('ı').map(p => p.toUpperCase().toLowerCase()).join('ı')
  .replace(/ς/g, 'σ').replace(/ß/g, 'ss').replace(CHEROKEE_SMALL, cherokeeCap);

/** A name as it is COMPARED: "Level 2", "level 2" and "Level  2 " are one
 *  floor to him, and so are "Oﬃce" and "Office" (Python's casefold()). */
export function classNorm(s) {
  return pyCasefold(classClean(s));
}

// Python's re \d and int(): any Unicode decimal digit, '２' and '٢' as well
// as '2'. Unicode assigns decimal digits only in runs of ten, 0 to 9, so a
// digit's value is how far it sits into its run.
const ND = /^\p{Nd}$/u;
const digitValue = ch => {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) return cp - 48;
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start -= 1;
  return (cp - start) % 10;
};
const asNumber = p => BigInt([...p].map(digitValue).join(''));

/** Level 2 before Level 10: the name split into runs of digits (compared as
 *  numbers -- BigInt, as Python's int has no limit) and everything else. */
export function classSortKey(s) {
  return classNorm(s).split(/(\p{Nd}+)/u).filter(Boolean)
    .map(p => (/^\p{Nd}+$/u.test(p) ? [0, asNumber(p), ''] : [1, 0n, p]));
}

/** Python's order of two strings: by code point (JS's < goes by UTF-16
 *  unit, and puts a character past U+FFFF before U+E000-U+FFFF). */
function cmpCodePoints(a, b) {
  if (a === b) return 0;
  const x = [...a];
  const y = [...b];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length - y.length;
}

/** Compare two names by classSortKey, as Python compares the key lists. */
export function cmpSortKey(a, b) {
  const ka = classSortKey(a);
  const kb = classSortKey(b);
  for (let i = 0; i < Math.min(ka.length, kb.length); i++) {
    for (let j = 0; j < 2; j++) {
      if (ka[i][j] < kb[i][j]) return -1;
      if (ka[i][j] > kb[i][j]) return 1;
    }
    const t = cmpCodePoints(ka[i][2], kb[i][2]);
    if (t) return t;
  }
  return ka.length - kb.length;
}

/** A stored name as the plan compares it -- Python's `str(x or "").strip()`
 *  -- and so as the Items list keys its headings and filters by it: a
 *  heading's rows are exactly what its Rename renames. (JS's trim() takes
 *  U+FEFF and leaves \x1c-\x1f and U+0085, so a name with one at an edge
 *  would be one heading and another rename.) */
export const classStrip = v => pyStrip(pyStr(v));

/** GLPageWidget._class_val: the field as a stripped string. */
const classVal = (d, field) => classStrip((d || {})[field]);

/**
 * This job's own names for `field`, each once, Level 2 before Level 10 --
 * what the item forms offer first. With `category`, only the sub-categories
 * filed under that category. A name that is only on a material line counts:
 * the desktop's does too.
 *
 * Ties (a name and its look-alike, 'Level 2' and 'level 2') keep the order
 * they were first met in, walking the store in its own order -- for the web
 * store, the sheets in order and then the items on no sheet. A declared
 * divergence: the desktop walks its sheets in the order they were first
 * drawn on, which its file keeps and JSON.parse cannot (integer keys come
 * first, ascending), so on a file the desktop wrote with its sheets out of
 * page order the look-alike met first -- the one a merge goes into, and the
 * one the name box lists first -- can be the other one. Never on a file the
 * web saved: the web writes the sheets in page order, and the desktop reads
 * them back so (tests/rename-python-truth.py r7_page_order).
 */
export function projectValues(store, field, category = null) {
  if (!CLASS_FIELDS.includes(field)) return [];
  const want = category === null || category === undefined
    ? null : pyStrip(pyStr(category));
  const seen = new Set();
  for (const lst of Object.values(store || {})) {
    for (const m of Array.isArray(lst) ? lst : []) {
      if (!isDict(m)) continue;
      const cat = classVal(m, 'category');
      if (want === null || cat === want) {
        const v = classVal(m, field);
        if (v) seen.add(v);
      }
      for (const ai of Array.isArray(m.associated_items) ? m.associated_items : []) {
        if (!isDict(ai)) continue;
        if (want !== null && (classVal(ai, 'category') || cat) !== want) continue;
        const v = classVal(ai, field);
        if (v) seen.add(v);
      }
    }
  }
  // Array.prototype.sort is stable, as Python's sorted() is.
  return [...seen].sort(cmpSortKey);
}

/**
 * A Floor or Trade box's suggestions: THIS job's names, then the stock list
 * without the look-alikes of names the job already has -- so a name he
 * renamed to is what he picks next time, and the old one does not creep
 * back in from the top of the presets. The desktop's _fill_class_combo,
 * minus its leading blank and its separator, which a datalist cannot show.
 */
export function classChoicesFrom(store, field, presets) {
  const own = projectValues(store, field);
  const have = new Set(own.map(classNorm));
  const rest = (presets || []).filter(p => p && !have.has(classNorm(p)));
  return [...own, ...rest];
}

// ── a heading's menu and tooltip ─────────────────────────────────────────

/** Which field each kind of heading is (TakeoffItemsPanel._HDR_FIELD). */
export const HDR_FIELD = Object.freeze({ floor: 'floor_level', cat: 'category', sub: 'sub_category' });
/** How the menu and the tooltip say that field (_HDR_WHAT). */
export const HDR_WHAT = Object.freeze({ floor_level: 'floor level', category: 'category',
  sub_category: 'sub-category' });
/** The section of the items on no sheet (the desktop's SHEET chip): never a
 *  floor's key (TakeoffItemsPanel._SOLO). The web lists no such section yet. */
export const SOLO = '\x00solo';

const ownProp = (obj, key) => (Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined);
const whatOf = type => ownProp(HDR_WHAT, ownProp(HDR_FIELD, type) || '') || '';

/**
 * What a heading's menu offers besides Collapse all and Expand all: 'rename'
 * it, 'assign' a floor level or a category to the items under a blank one,
 * 'group' (the Group's own form), or '' for the items on no sheet. The menu
 * and the heading's tooltip both ask here, so the tooltip cannot offer what
 * the menu does not have. (A Group's section key is '\x00g:' + its id.)
 */
export function headerAct(meta) {
  const t = meta.type;
  const fl = pyStr(meta.fl);
  const gid = fl.startsWith('\x00g:') ? fl.slice(3) : '';
  if (t === 'floor' && fl === SOLO) return '';
  if (t === 'floor' && gid) return 'group';
  if (t === 'floor') return fl ? 'rename' : 'assign';
  if (t === 'cat') return meta.cat ? 'rename' : 'assign';
  return 'rename';
}

/**
 * A heading's tooltip: what a click, a drag and a right-click do on THIS
 * heading, and nothing they do not -- worked out from the SAME `act` as its
 * menu. `canDrag` false until the web can reorder; `touch` says it in a
 * finger's words (the user's choice: a tap, a hold), the same sentence.
 */
export function headerTip(meta, { canDrag = true, act = headerAct(meta), touch = false } = {}) {
  const parts = [touch ? 'Tap to collapse / expand' : 'Click to collapse / expand'];
  // The items on no sheet are not a floor to move (_valid_drop).
  if (canDrag && !(meta.type === 'floor' && meta.fl === SOLO)) parts.push('Drag to reorder');
  const how = touch ? 'Hold' : 'Right-click';
  const what = whatOf(meta.type);
  const right = act === 'rename' ? `${how} to rename`
    : act === 'group' ? `${how} to rename the group`
      : act === 'assign' ? `${how} to set a ${what}`
        : '';
  if (right) parts.push(right);
  return parts.join('  •  ');
}

/**
 * The rows the list showed under a heading when it was built -- collapsed
 * ones included, ones the filters hide not. `tree` is the Items list's own:
 * Map floor -> Map category -> Map sub-category -> [[page, item], ...].
 */
export function rowsUnder(tree, meta) {
  const fl = meta.fl;
  const cat = meta.cat;
  if (!tree || !tree.has(fl)) return [];
  const cats = tree.get(fl);
  const items = subs => [...subs.values()].flatMap(list => list.map(([, m]) => m));
  if (meta.type === 'floor') return [...cats.values()].flatMap(items);
  if (!cats.has(cat)) return [];
  if (meta.type === 'cat') return items(cats.get(cat));
  return (cats.get(cat).get(meta.sub) || []).map(([, m]) => m);
}

/**
 * The rows a heading's menu NAMED (rowsUnder when it opened), as the job
 * holds them now. The web's menu is not modal: an Undo while it is up puts
 * a copy of every item, and a page turn with the SHEET chip on rebuilds the
 * list for the next sheet under it -- the same heading, other rows. So each
 * row is found again by who it is, its `_uid` (an Undo's copies keep it),
 * never by where its heading sits now. Only the ones still in the job,
 * still a row and still blank in `field`, in the menu's order; none when
 * none is left.
 */
export function rowsNow(store, rows, field) {
  const byUid = new Map();
  const here = new Set();
  for (const lst of Object.values(store || {})) {
    for (const m of listOf(lst)) {
      if (!isDict(m)) continue;
      here.add(m);
      if (m._uid && !byUid.has(m._uid)) byUid.set(m._uid, m);
    }
  }
  const out = [];
  const seen = new Set();
  for (const r of rows || []) {
    if (!isDict(r)) continue;
    const m = (r._uid && byUid.get(r._uid)) || (here.has(r) ? r : null);
    if (!m || seen.has(m) || !isClassRow(m) || classVal(m, field)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

// ── renaming a heading: what is renamed, everywhere ──────────────────────
//
// There is no list of floors anywhere. A floor level, a category and a
// sub-category are strings on each shape, on each material line that
// carries its own, and on the hand-added lines kept in a framed item's
// answers -- and the desktop and every older version read those strings and
// nothing else. So a rename REWRITES them, as one undo level, exactly where
// the desktop's classification_plan finds them: a file renamed here is the
// file the desktop would have written.

/** Words the lists use for themselves (CLASS_RESERVED): 'All Floors' is
 *  the TEXT the Data Tables compare against to mean "no filter". */
export const CLASS_RESERVED = Object.freeze(['All Floors', 'All Groups', 'All Categories',
  'All Trades', '(No Floor Level)', '(Uncategorized)', 'No Floor Level', 'Uncategorized']);

/** The trades the desktop's framing engine writes onto the lines it makes
 *  itself (ENGINE_CATEGORIES): a rename moves the lines that exist; the
 *  engine goes on writing these. */
export const ENGINE_CATEGORIES = Object.freeze(['Framing', 'Hardware']);

/** Where a framed item's hand-added lines live in its answers (framing.py
 *  EXTRAS_KEY). */
export const EXTRAS_KEY = '_extras';

/** Python's truth: '', 0, null, false, [] and {} are all false. */
const pyTrue = v => !!v && !(Array.isArray(v) && !v.length) && !(isDict(v) && !Object.keys(v).length);

/** Why `name` cannot be a floor level or a category ('' when it can). */
export function classNameProblem(name) {
  const n = classClean(name);
  if (!n) return 'Type a name.';
  if (CLASS_RESERVED.some(r => classNorm(r) === classNorm(n))) {
    return `'${n}' is what the lists call themselves — pick another name.`;
  }
  return '';
}

const isGroupItem = m => isDict(m) && m.type === 'group';

/** A row of the Items panel (GLPageWidget._class_is_row): takeoff, or a
 *  Group container -- never another shape of an item (it rolls up into its
 *  item's row) and never a ruler, a note or a callout. */
export function isClassRow(m) {
  return isDict(m) && (isTakeoffType(m) || isGroupItem(m)) && !pyTrue(m.group_child);
}

/** A store's page keys in the desktop's page_sort_key order: the keys that
 *  are whole numbers by number -- the items on no sheet (-1000) FIRST, as
 *  int() makes them -- then anything else by its text. */
function pageKeys(store) {
  const key = k => (/^\s*[-+]?\d+\s*$/.test(k) ? [0, Number(k), ''] : [1, 0, String(k)]);
  return Object.keys(store || {}).sort((a, b) => {
    const ka = key(a), kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  });
}

const listOf = v => (Array.isArray(v) ? v : []);
/** `scope.category` as the desktop reads it: null for none, else stripped. */
const scopeCat = scope => {
  const c = scope ? scope.category : undefined;
  return c === null || c === undefined ? null : pyStrip(String(c));
};

/**
 * Every place that files something under `old` in `field`, as
 * [[dict, field, kind]]. Nothing is changed (classification_plan).
 *
 * `scope` narrows it: {category} keeps a sub-category to the one category it
 * sits under (the same 'Exterior' can be under Walls and under Doors),
 * {group} to the items in one Group container (kept so it stays
 * truth-checked; the web lists no Group section to ask it from yet).
 *
 * kind: 'item' (a row of the Items list -- a Group container too, which the
 * web does not list but renames), 'shape' (another shape of one), 'aid' (a
 * ruler or a note), 'line' (a material line's OWN value -- a blank one takes
 * its item's when a report reads it, and is left blank), 'extra' (a
 * hand-added line in a framed item's answers) and 'spec' (the record of what
 * that line was asked to be: left behind, the desktop's next framing
 * recompute would undo the rename).
 */
export function classificationPlan(store, field, old, scope = null) {
  old = pyStrip(pyStr(old));
  if (!CLASS_FIELDS.includes(field) || !old) return [];
  const sc = scope || {};
  const sCat = scopeCat(sc);
  const sGrp = pyStr(sc.group);
  const masters = new Map();
  for (const lst of Object.values(store || {})) {
    for (const m of listOf(lst)) {
      if (isDict(m) && pyTrue(m.group_id) && !pyTrue(m.group_child) && !masters.has(m.group_id)) {
        masters.set(m.group_id, m);
      }
    }
  }
  const plan = [];
  const seen = new Set();
  const take = (d, kind) => {
    if (seen.has(d)) return;            // a list two items share, once
    seen.add(d);
    plan.push([d, field, kind]);
  };
  for (const pg of pageKeys(store)) {
    for (const m of listOf(store[pg])) {
      if (!isDict(m)) continue;
      let own = m;
      if (pyTrue(m.group_child)) own = masters.get(m.group_id) || m;
      if (sGrp && !(pyStr(own.in_group) === sGrp
          || (isGroupItem(own) && pyStr(own.group_item_id) === sGrp))) continue;
      const ownCat = classVal(own, 'category');
      if (classVal(m, field) === old && (sCat === null || ownCat === sCat)) {
        take(m, pyTrue(m.group_child) ? 'shape' : isClassRow(m) ? 'item' : 'aid');
      }
      for (const ai of listOf(m.associated_items)) {
        if (!isDict(ai)) continue;
        if (classVal(ai, field) === old
            && (sCat === null || (classVal(ai, 'category') || ownCat) === sCat)) take(ai, 'line');
        const fs = ai.framing_spec;
        if (isDict(fs) && classVal(fs, field) === old
            && (sCat === null || classVal(fs, 'category') === sCat)) take(fs, 'spec');
      }
      const fr = m.framing;
      const params = isDict(fr) ? fr.params : null;
      const extras = isDict(params) ? params[EXTRAS_KEY] : null;
      for (const sp of listOf(extras)) {
        if (!isDict(sp)) continue;
        // A hand-added line with no trade of its own is filed under the
        // engine's (framing.extra_line writes it so).
        const spCat = classVal(sp, 'category') || 'Framing';
        const v = field === 'category' ? spCat : classVal(sp, field);
        if (v === old && (sCat === null || spCat === sCat)) take(sp, 'extra');
      }
    }
  }
  return plan;
}

/** How many of each kind a plan holds (_plan_counts). */
export function planCounts(plan) {
  const out = { items: 0, shapes: 0, aids: 0, lines: 0, extras: 0, specs: 0 };
  for (const [, , kind] of plan || []) out[`${kind}s`] += 1;
  return out;
}

/** Every row of the Items panel with nothing in `field`, job-wide
 *  (unfiled_items) -- the Group containers among them. */
export function unfiledItems(store, field) {
  const out = [];
  for (const lst of Object.values(store || {})) {
    for (const m of listOf(lst)) if (isClassRow(m) && !classVal(m, field)) out.push(m);
  }
  return out;
}

/**
 * What filing `items` under a name writes (assign_classification's plan):
 * each of them that is still blank, and every other shape of it -- a floor
 * level is the whole item's, wherever its shapes are drawn -- and nothing
 * else. Its material lines stay blank: a blank line takes its item's value
 * when a report reads it. A dict no longer in the store (the list was built
 * before an undo, which puts a copy of every item back) is written nowhere.
 */
export function assignPlan(store, field, items) {
  const live = new Set();
  const shapesOf = new Map();
  for (const lst of Object.values(store || {})) {
    for (const m of listOf(lst)) {
      live.add(m);
      if (isDict(m) && pyTrue(m.group_id)) {
        if (!shapesOf.has(m.group_id)) shapesOf.set(m.group_id, []);
        shapesOf.get(m.group_id).push(m);
      }
    }
  }
  const plan = [];
  const seen = new Set();
  for (const m of items || []) {
    if (!live.has(m) || seen.has(m) || !isClassRow(m) || classVal(m, field)) continue;
    seen.add(m);
    plan.push([m, field, 'item']);
    const gid = m.group_id;
    for (const s of (pyTrue(gid) && shapesOf.get(gid)) || []) {
      if (seen.has(s)) continue;
      seen.add(s);
      plan.push([s, field, 'shape']);
    }
  }
  return plan;
}

// ── where new pins are filed (metadata.pin_filing) ───────────────────────
//
// A pin is dropped with no form, so it is filed under its kind's trade. That
// trade is RECORDED by the one act that means it -- renaming the trade for
// the whole job -- and kept with the job: metadata.pin_filing =
// {kind: {category, sub_category?}}, only where it differs from stock and
// gone when it is back to stock. The web places window and door pins only;
// it keeps the partition and header records too, which the desktop reads.

/** Every pin kind the desktop has (PIN_KINDS). */
export const PIN_KINDS = Object.freeze(['window', 'door', 'partition', 'header']);
const FRAMING_PIN_STOCK = Object.freeze({
  partition: Object.freeze(['Wood Framing', 'Partitions']),
  header: Object.freeze(['Wood Framing', 'Headers']),
});

/** Where a pin of `kind` is filed in a job that never renamed its trade, as
 *  [category, sub]; sub null for a window or a door (they take the last
 *  item's sub-category). null for anything that is not a pin (_pin_stock). */
export function pinStock(kind) {
  if (!PIN_KINDS.includes(kind)) return null;
  const spec = FRAMING_PIN_STOCK[kind];
  return spec ? [spec[0], spec[1]] : ['Doors & Windows', null];
}

/** The pin kinds this job files somewhere other than stock, as
 *  {kind: [category, sub]}, read off its metadata (_pin_files). */
export function pinFiles(meta) {
  const raw = isDict(meta) ? meta.pin_filing : null;
  const out = {};
  for (const [kind, rec] of (isDict(raw) ? Object.entries(raw) : [])) {
    const stock = pinStock(kind);
    if (stock === null || !isDict(rec)) continue;
    const cat = pyStrip(pyStr(rec.category));
    if (!cat) continue;
    let sub = null;
    if (stock[1] !== null) sub = pyStrip(pyStr(rec.sub_category)) || stock[1];
    out[kind] = [cat, sub];
  }
  return out;
}

/** What a new pin of `kind` is filed under, as [category, sub] (_pin_filing). */
export function pinFiling(meta, kind) {
  const files = pinFiles(meta);
  return Object.prototype.hasOwnProperty.call(files, kind) ? files[kind] : pinStock(kind);
}

/** Record that new pins of `kind` are filed under [category, sub]: only what
 *  differs from stock is written, so a job that never renamed its pin trades
 *  carries no key at all. False with nowhere to keep it (_set_pin_filing). */
export function setPinFiling(meta, kind, filing) {
  const stock = pinStock(kind);
  if (!isDict(meta) || stock === null) return false;
  const raw = meta.pin_filing;
  const files = isDict(raw) ? { ...raw } : {};
  const [cat, sub] = filing;
  if (cat === stock[0] && sub === stock[1]) {
    delete files[kind];
  } else {
    const rec = { category: cat };
    if (stock[1] !== null) rec.sub_category = sub;
    files[kind] = rec;
  }
  if (Object.keys(files).length) meta.pin_filing = files;
  else delete meta.pin_filing;
  return true;
}

/**
 * Where new pins are filed follows a rename of their trade (_follow_pin_filing):
 * a category renamed -- or merged -- for the whole job moves every pin kind
 * filed under it (windows and doors share 'Doors & Windows', so both move,
 * with no door in the job yet), and a sub-category renamed under that
 * category moves the kind filed under it. A floor rename moves none, and nor
 * does a rename for one Group's items. Returns the moves, as
 * [['pin', null, kind, was, now]].
 */
export function followPinFiling(meta, field, old, nu, scope = null) {
  const sc = scope || {};
  if (!['category', 'sub_category'].includes(field) || pyTrue(sc.group)) return [];
  const sCat = scopeCat(sc);
  const moves = [];
  for (const kind of PIN_KINDS) {
    const was = pinFiling(meta, kind);
    const [cat, sub] = was;
    let now;
    if (field === 'category') {
      if (cat !== old) continue;
      now = [nu, sub];
    } else {
      if (sub === null || sub !== old || (sCat !== null && cat !== sCat)) continue;
      now = [cat, nu];
    }
    if (setPinFiling(meta, kind, now)) moves.push(['pin', null, kind, was, now]);
  }
  return moves;
}

// ── what the TOOL and the LIST hold follows the new name ─────────────────
//
// A move is [where, holder, name, was, now], the desktop's own shape:
//   'attr' -- holder[name], a value on the tool (the next item's floor and
//             sub-category) or on the list (its floor and group filters);
//   'spec' -- the armed count's answers, holder[name];
//   'fold' -- the web's own, ['fold', set, oldKey, newKey, newWasFolded]: a
//             folded heading the rename carried from `oldKey` to `newKey` in
//             the list's set of folded keys, ONE move for both halves (and
//             `newWasFolded` when the new heading was folded already -- a
//             merge). The desktop does not take a fold back with Ctrl+Z; the
//             web does, so ONE Undo puts the whole list back -- but only
//             while both keys still hold what the step left: unfolding the
//             new heading (a tap, Expand all) is his, and Undo then folds
//             neither.
// None of it is in the undo snapshot (it is the tool and the view, not the
// document), so the rename's undo level carries the moves (Project.tagTool)
// and an undo or redo hands them back here (applyClassTool).

/** The tool fields a rename of each field moves (the desktop's
 *  _last_floor / _last_category / _last_sub). The web keeps no last
 *  category (ToolController._base files a new item under none), so a
 *  category rename never moves one and a sub-category moves only under the
 *  blank category -- the web's own state, followed faithfully. */
const TOOL_ATTR = Object.freeze({ floor_level: '_lastFloor', category: '_lastCategory',
  sub_category: '_lastSub' });

/** What the tool holds that a rename can move (_class_tool_now). */
export function classToolNow(tool) {
  const out = ['_lastFloor', '_lastCategory', '_lastSub'].map(a => ['attr', tool, a, tool[a]]);
  const spec = tool.countSpec;
  if (isDict(spec)) for (const f of CLASS_FIELDS) out.push(['spec', spec, f, spec[f]]);
  return out;
}

/** What has changed since `was` (_class_tool_moved). */
export function classToolMoved(was) {
  const out = [];
  for (const [where, holder, name, val] of was) {
    const now = holder[name];
    if (now !== val) out.push([where, holder, name, val, now]);
  }
  return out;
}

/**
 * What the TOOL holds that names `old` follows a rename
 * (_follow_classification): the floor and sub-category the next item is
 * given, and an armed count's answers. Without it the next pin or count,
 * which have no form, files itself under the name just renamed away.
 */
export function followClassification(tool, field, old, nu, scope = null) {
  const sc = scope || {};
  if (pyTrue(sc.group)) return;            // a new item is in no group
  const sCat = scopeCat(sc);
  const attr = TOOL_ATTR[field];
  if (pyStrip(pyStr(tool[attr])) === old
      && (sCat === null || pyStrip(pyStr(tool._lastCategory)) === sCat)) tool[attr] = nu;
  const spec = tool.countSpec;
  if (isDict(spec) && classVal(spec, field) === old
      && (sCat === null || classVal(spec, 'category') === sCat)) spec[field] = nu;
}

/** The rename's moves of the tool, as rename_classification makes them:
 *  what the tool held, followed, then what changed. */
export function followTool(tool, field, old, nu, scope = null) {
  const was = classToolNow(tool);
  followClassification(tool, field, old, nu, scope);
  return classToolMoved(was);
}

/**
 * An undo (or redo) of a rename gives its moves back (desktop
 * _undo_class_tool, the 'clip' branch left out: the web has no item
 * clipboard). `detail` is the Project's 'class-tool' event {tag, direction,
 * applied}; `mine(move)` picks the moves this holder answers for; `countSpec`
 * says which answers are armed now. Each move is put back -- or forward --
 * only while it still holds what the rename left there: anything he has
 * chosen since is his, and wins. Put back exactly as it was, never renamed
 * back. Every move that applied is added to `applied`, so the level that
 * reverses this one carries only those.
 */
export function applyClassTool(detail, mine, { countSpec = () => null } = {}) {
  const { tag, direction, applied } = detail || {};
  const back = direction === 'undo';
  for (const mv of (tag && tag.moves) || []) {
    if (!mine(mv)) continue;
    const [where, holder, name, was, now] = mv;
    const [frm, to] = back ? [now, was] : [was, now];
    if (where === 'spec') {
      if (holder !== countSpec() || holder[name] !== frm) continue;   // another count armed, or answered
      holder[name] = to;
    } else if (where === 'fold') {
      // [oldKey, newKey, newWasFolded]: both halves of one renamed fold,
      // and only while BOTH still hold what the step left.
      const [oldKey, newKey, hadNew] = [name, was, now];
      const left = back ? holder.has(newKey) && !holder.has(oldKey)
        : holder.has(oldKey) && holder.has(newKey) === hadNew;
      if (!left) continue;
      if (back) {
        holder.add(oldKey);
        if (!hadNew) holder.delete(newKey);
      } else {
        holder.delete(oldKey);
        holder.add(newKey);
      }
    } else if (where === 'attr') {
      if (holder[name] !== frm) continue;
      holder[name] = to;
    } else {
      continue;
    }
    if (applied) applied.add(mv);
  }
}

// ── the list's keys of folded headings ───────────────────────────────────

const FOLD_PARTS = Object.freeze({ fl: 2, cat: 3, sub: 4 });

/** A folded heading's key ('fl\0Level 1', 'cat\0Level 1\0Walls',
 *  'sub\0…\0…\0…') as the desktop's tuple; the items on no sheet's floor
 *  (SOLO, itself starting with \0) is read as one part. null for a key
 *  this cannot read -- kept as it is. */
export function foldParts(key) {
  const parts = String(key).split('\x00');
  const n = FOLD_PARTS[parts[0]];
  if (!n) return null;
  if (parts.length === n) return parts;
  if (parts.length === n + 1 && parts[1] === '' && parts[2] === SOLO.slice(1)) {
    return [parts[0], SOLO, ...parts.slice(3)];
  }
  return null;
}

/**
 * The list's state that names `old` follows the rename (_follow_rename):
 * the floor and group filters, and which headings are folded. Done BEFORE
 * the rebuild the rename makes -- after it, a filter has already found its
 * value gone and fallen back to All. `state` is the list
 * ({floorFilter, groupFilter, collapsed}); the set is rewritten in place.
 * Returns the folds it carried, as 'fold' moves: one per renamed fold,
 * [ 'fold', set, oldKey, newKey, newWasFolded ].
 */
export function followRename(state, field, old, nu, scope = null) {
  const sc = scope || {};
  const gkey = pyTrue(sc.group) ? `\x00g:${String(sc.group)}` : null;
  const sCat = sc.category === undefined || sc.category === null ? null : sc.category;
  if (field === 'floor_level' && state.floorFilter === old) state.floorFilter = nu;
  else if (field === 'category' && gkey === null && state.groupFilter === old) state.groupFilter = nu;
  const before = new Set(state.collapsed);
  const out = new Set();
  const carried = [];
  for (const key of before) {
    let k = foldParts(key);
    if (k === null) { out.add(key); continue; }
    if (gkey === null || (k.length > 1 && k[1] === gkey)) {
      if (field === 'floor_level' && k.length > 1 && k[1] === old) k = [k[0], nu, ...k.slice(2)];
      else if (field === 'category' && k.length > 2 && k[2] === old) k = [...k.slice(0, 2), nu, ...k.slice(3)];
      else if (field === 'sub_category' && k.length === 4 && k[3] === old
        && (sCat === null || k[2] === sCat)) k = [...k.slice(0, 3), nu];
    }
    const now = k.join('\x00');
    out.add(now);
    if (now !== key) carried.push([key, now]);
  }
  // Each renamed fold is ONE move, both its halves: an Undo puts the old
  // heading's fold back only while the new heading is still folded as the
  // rename left it (applyClassTool). (A key is carried from exactly one
  // old key: the two differ only in the part that was `old`.)
  const moves = carried.map(([k, now]) => ['fold', state.collapsed, k, now, before.has(now)]);
  state.collapsed.clear();
  for (const k of out) state.collapsed.add(k);
  return moves;
}

// ── the words: the form, the question, the status line ───────────────────

/** '1 item', '9 items' (_n). */
export function nOf(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** '9 items', '9 items and 3 material lines', '3 material lines' (_amount). */
export function amountWords(counts) {
  const parts = [];
  if (counts.items) parts.push(nOf(counts.items, 'item'));
  if (counts.lines) parts.push(nOf(counts.lines, 'material line'));
  return parts.join(' and ') || 'nothing';
}

/** Python's str.title() for the few words a heading's form names. */
export function pyTitle(s) {
  return String(s).replace(/[A-Za-z]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Python's str.capitalize(). */
export function pyCapitalize(s) {
  const t = String(s);
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t;
}

/**
 * The spelling already in the job that `nu` is the same name as (ignoring
 * case and spaces), or null (_existing_spelling). Renaming 'level 2' into an
 * existing 'Level 2' is a merge into THAT spelling; respelling the only
 * 'level 2' as 'Level 2' is not.
 */
export function existingSpelling(store, field, nu, old, category = null) {
  const key = classNorm(nu);
  const cands = projectValues(store, field, category)
    .filter(v => classNorm(v) === key && v !== old);
  if (!cands.length) return null;
  return cands.includes(nu) ? nu : cands[0];
}

/** The name box's lists: this job's own names (a sub-category's: the ones
 *  under its category), then the stock list without their look-alikes. */
export function classLists(store, field, category, presets) {
  const own = projectValues(store, field, category);
  const have = new Set(own.map(classNorm));
  const rest = (presets || []).filter(p => p && !have.has(classNorm(p)));
  return { own, rest };
}

/**
 * The rename form's sentence -- what will change, BEFORE OK, the items the
 * list's filters hide included (_rename_from_header's describe). `listed`
 * is the set of items the last build listed (the desktop's _listed_ids).
 */
export function renameWhat(store, field, old, base, opt, listed) {
  const sc = { ...(base || {}) };
  if (opt) sc.group = opt;
  const plan = classificationPlan(store, field, old, sc);
  const n = planCounts(plan);
  const where = field === 'sub_category' ? `'${old}' under '${base.category}'` : `'${old}'`;
  let txt = `Renames ${where} on ${amountWords(n)}.`;
  let hid = 0;
  for (const [d, , kind] of plan) if (kind === 'item' && !(listed && listed.has(d))) hid += 1;
  if (hid) {
    const be = hid === 1 ? 'is' : 'are';
    txt += ` ${hid} of them ${be} hidden by the list's filters and ${be} renamed too.`;
  }
  if (n.aids) txt += ` Also on ${nOf(n.aids, 'note or ruler')}.`;
  return txt;
}

/** The form's amber notes: renaming the trade the desktop's framing engine
 *  writes. (The desktop also names the Report Center presets that ask for
 *  the old name; the web cannot see them -- the user's decision 3.) */
export function renameNotes(field, old) {
  if (field === 'category' && ENGINE_CATEGORIES.includes(old)) {
    return [`New framing lines the program adds later will still be filed under '${old}'.`];
  }
  return [];
}

/** The question before a merge: "Merge 1 item into 'Level 2' (1 item)?" */
export function mergeQuestion(store, field, plan, into, base) {
  const here = planCounts(plan);
  const there = planCounts(classificationPlan(store, field, into, base));
  const src = here.items ? nOf(here.items, 'item') : amountWords(here);
  const dst = there.items ? nOf(there.items, 'item') : `on ${amountWords(there)}`;
  return `Merge ${src} into '${into}' (${dst})?`;
}

/** The web's last words for a step the toolbar's Undo takes back (the
 *  user's decision 1: the desktop says '— Ctrl+Z puts it back'). */
export const UNDO_WORDS = '— Undo puts it back';

/** The status line after a rename. */
export function renameSaid(field, old, nu, merged, counts) {
  const what = HDR_WHAT[field];
  return `${merged ? 'Merged' : 'Renamed'} ${what} '${old}' ${merged ? 'into' : 'to'} '${nu}' `
    + `on ${amountWords(counts)} ${UNDO_WORDS}`;
}

/** {group_id: the sheets its shapes are on} (the items on no sheet are on
 *  none), for the Set form's sentence. */
export function sheetsOfGroups(store) {
  const out = new Map();
  for (const [pg, lst] of Object.entries(store || {})) {
    if (Number(pg) === -1000) continue;
    for (const m of listOf(lst)) {
      if (!isDict(m) || !pyTrue(m.group_id)) continue;
      if (!out.has(m.group_id)) out.set(m.group_id, new Set());
      out.get(m.group_id).add(pg);
    }
  }
  return out;
}

/** The Set form's sentence (_assign_from_header's describe): `pick` the
 *  items it would file, `filtered` whether the list was filtered and the
 *  choice is the listed ones. */
export function assignWhat(field, pick, filtered, sheetsOf) {
  const what = HDR_WHAT[field];
  let txt = `Sets the ${what} of ${nOf(pick.length, 'item')}.`;
  if (filtered) txt += ' The list is filtered, so only the items it is showing are included.';
  let multi = 0;
  for (const m of pick) {
    if (pyTrue(m.group_id) && ((sheetsOf.get(m.group_id) || new Set()).size > 1)) multi += 1;
  }
  if (multi) {
    txt += ` ${multi} of them ${multi === 1 ? 'has' : 'have'} shapes on more than one sheet — a `
      + `${what} belongs to the whole item, so every shape gets it.`;
  }
  return txt;
}

/** The Set form's choice, when the job has unfiled items the list is not
 *  showing; null when the two are the same items. */
export function assignOptions(field, listed, job) {
  const a = new Set(listed);
  const b = new Set(job);
  if (a.size === b.size && [...a].every(m => b.has(m))) return null;
  const hdr = field === 'floor_level' ? 'NO FLOOR LEVEL' : 'Uncategorized';
  return [[`The ${nOf(listed.length, 'item')} listed under ${hdr}`, 'listed'],
    [`Every item in the job with no ${HDR_WHAT[field]} (${job.length})`, 'job']];
}

/** The status line after a Set. */
export function assignSaid(field, counts, value) {
  return `Filed ${nOf(counts.items, 'item')} under the ${HDR_WHAT[field]} '${value}' ${UNDO_WORDS}`;
}

// ── the writes ───────────────────────────────────────────────────────────

/**
 * Rename the floor level, category or sub-category `old` to `nu` everywhere
 * classificationPlan finds it, as ONE undo level (rename_classification).
 *
 * Returns the counts (planCounts); {} when nothing reads `old` or the name is
 * unchanged; null when `nu` is not a name a list can hold. A merge into a
 * name already in use is the caller's question to ask: this writes exactly
 * the spelling it is given.
 *
 * Where new pins are filed (metadata.pin_filing) is written inside the step,
 * so the undo snapshot takes it back with the names. What the rename moves
 * in the TOOL (`followTool(field, old, nu, scope)`, the controller's) and
 * `also`, what the caller moved for it on its own side (the list's filters
 * and folds), ride the step's own undo level (Project.tagTool), so one Undo
 * puts those back too, and Redo forward again.
 */
export function renameClassification(project, field, old, nu, scope = null,
  { followTool: follow = null, also = [] } = {}) {
  if (!CLASS_FIELDS.includes(field)) return null;
  old = pyStrip(pyStr(old));
  nu = classClean(nu);
  if (classNameProblem(nu)) return null;
  if (!old || nu === old) return {};
  const plan = classificationPlan(project.measurements, field, old, scope);
  if (!plan.length) return {};
  // A merge: `nu` is a name the job had before the rename.
  const merged = projectValues(project.measurements, field, scopeCat(scope || {})).includes(nu);
  let pins = [];
  project.transact(`Rename ${HDR_WHAT[field]}`, () => {
    for (const [d, k] of plan) d[k] = nu;
    pins = followPinFiling(project.metadata, field, old, nu, scope);
  });
  const moves = follow ? [...(follow(field, old, nu, scope) || [])] : [];
  // (a value that did not move is no move; a fold always moved)
  for (const mv of also || []) if (mv[0] === 'fold' || mv[3] !== mv[4]) moves.push(mv);
  project.tagTool(project.undoTop, {
    kind: 'class_tool', moves, rename: [field, old, nu, { ...(scope || {}) }, merged], pins,
  });
  project.emit('items-changed', {});
  return planCounts(plan);
}

/**
 * File items that have no floor level (or no category) under `value`, as ONE
 * undo level (assign_classification): the rows listed under NO FLOOR LEVEL
 * or Uncategorized, and their other shapes, and nothing else. `also` is what
 * the list moved for it (a filter on the blank following the items), carried
 * on the level like a rename's. Returns the counts; {} when nothing is
 * blank; null for a name a list cannot hold.
 */
export function assignClassification(project, field, value, items, { also = [] } = {}) {
  if (!CLASS_FIELDS.includes(field)) return null;
  value = classClean(value);
  if (classNameProblem(value)) return null;
  const plan = assignPlan(project.measurements, field, items);
  if (!plan.length) return {};
  project.transact(`Set ${HDR_WHAT[field]}`, () => {
    for (const [d, k] of plan) d[k] = value;
  });
  const moves = (also || []).filter(mv => mv[3] !== mv[4]);
  if (moves.length) project.tagTool(project.undoTop, { kind: 'class_tool', moves });
  project.emit('items-changed', {});
  return planCounts(plan);
}

// revisions.js — plan revisions: the model, and the rule for "which drawing is
// current". Pure logic, no DOM, no pixels.
//
// WHAT A REVISION IS. The architect reissues part of the set. Those sheets are
// imported as a REVISION SET: a list of pages that sits alongside the original
// drawings rather than replacing them, because the takeoff on a sheet was
// traced over that sheet's own lines and moving it to a different drawing would
// put measurements on lines they were never taken from.
//
// So a project holds one original set plus N revision sets, and every sheet
// number can have several versions. Two questions follow, and this module
// answers both the way the desktop app does:
//
//   · which versions does this sheet have?            sheetVersions()
//   · which one of them is the CURRENT drawing?       newestVersionOf()
//                                                     resolveLatestSheets()
//
// "Newest" is the hard one. Revision dates are typed by hand, arrive in several
// formats, are sometimes blank, and two revisions issued the same day are
// ordinary. Measured on the estimator's largest job: 11 revision sets, dates
// written as "3-4-2026", "05/6/2026" and "06-19-2026" — and the one written
// "06-19-2026" sits NINTH in the list, so list order is not date order. The
// rule is therefore stated once, here, and used by everything that has an
// opinion about which drawing is current.
//
// ─────────────────────────────────────────────────────────────────────────
// PORTING NOTE. The desktop holds `rev["images"]` — decoded PIL pages — and
// bounds-checks every page index against it. This app never holds a revision's
// pixels: on the largest real job the revision tail alone is 1.42 GB. It holds
// the BLOB COUNT read out of the file's index, as `rev.pageCount`, and bounds-
// checks against that instead. Verified against the library: the blob count and
// page_labels.length agree on every revision set in every project that has one.
// ─────────────────────────────────────────────────────────────────────────
//
// Checked against the desktop's own functions by tests/revisions-logic.mjs,
// which runs them through tests/revisions-python-truth.py rather than against
// a transcription of them.

/** How many pages a revision set has, without holding one of them. */
export function revPageCount(rev) {
  if (!rev) return 0;
  if (Number.isFinite(rev.pageCount)) return rev.pageCount;
  return (rev.page_labels || []).length;
}

/**
 * The revisions the DESKTOP has: every record whose pages the file carries.
 *
 * The desktop keeps a revision only when its images came with it
 * (`_on_cache_loaded`: `if _r["images"]`). A record with no pages is not a
 * revision there at all — so a sheet booked to one counts from its own
 * drawing, a name is numbered without it, and an item stamped with it is "a
 * revision since removed". This app keeps such a record so a save can write
 * it back, which makes it the one list that must never be counted, numbered
 * or ranked against. Everything that decides a total or a name asks this.
 */
export function liveRevisions(revs) {
  return (revs || []).filter(r => revPageCount(r) > 0);
}

// ── one name per revision ────────────────────────────────────────────────

/** The longest description that is a revision's NAME (REV_NAME_MAX). */
export const REV_NAME_MAX = 12;

const REV_NUMBER_NAME_RE = /^(?:REV(?:ISION)?|R)\.?\s*#?\s*(\d+)$/i;

/** Python's `" ".join(str(s).split())`. */
function squash(s) {
  return String(s == null ? '' : s).split(/\s+/).filter(Boolean).join(' ');
}

/** Python's str.casefold, for the ASCII and Latin text a description holds. */
function casefold(s) {
  return String(s).toLowerCase().replace(/ß/g, 'ss');
}

/**
 * THE name of a revision, on every screen and in every sentence (desktop
 * `revision_short_name`).
 *
 * Its own description when that is a name: at most REV_NAME_MAX letters,
 * carried by no other revision in `revisions`, and not a revision number
 * other than its own ("Revision 10" typed on the first one). Otherwise
 * "REV n" — `number` is its place in the order the revisions were added,
 * from 1, hidden and archived ones included, so hiding one renames none.
 * One revision, one name: "REV 1" on a tile and "ASI 1" in the question about
 * it was two names for one drawing.
 */
export function revisionShortName(rev, number, revisions = []) {
  let d = squash((rev || {}).description);
  if (d && [...d].length <= REV_NAME_MAX) {
    const mm = REV_NUMBER_NAME_RE.exec(d);
    if (mm && parseInt(mm[1], 10) !== Math.trunc(Number(number))) {
      d = '';
    } else if ((revisions || []).some(r => r !== rev
        && casefold(squash(r.description)) === casefold(d))) {
      d = '';
    }
    if (d) return d;
  }
  return `REV ${Math.trunc(Number(number))}`;
}

/**
 * A revision's number on screen: its place among the revisions the desktop
 * has (liveRevisions), from 1, hidden and archived ones included. 0 for a
 * sheet's own drawing or an id no revision answers to.
 */
export function revisionNumber(revId, revs) {
  const rid = String(revId || '');
  if (!rid) return 0;
  const live = liveRevisions(revs);
  for (let k = 0; k < live.length; k++) {
    if (String(live[k].id) === rid) return k + 1;
  }
  return 0;
}

/**
 * The one name of a revision by id (desktop `rev_name`): '' for the sheet's
 * own drawing, "removed revision" for an id the project no longer has, and
 * " (hidden)" after a hidden or archived one when asked.
 */
export function revNameOf(revId, revs, hiddenNote = false) {
  const rid = String(revId || '');
  if (!rid) return '';
  const live = liveRevisions(revs);
  const k = live.findIndex(r => String(r.id) === rid);
  if (k < 0) return 'removed revision';
  const rev = live[k];
  let nm = revisionShortName(rev, k + 1, live);
  if (hiddenNote && !(rev.visible !== false && !rev.archived)) nm += ' (hidden)';
  return nm;
}

/** {rev_id: name} for every revision (desktop `revision_names`). */
export function revisionNamesOf(revs) {
  const out = {};
  for (const r of liveRevisions(revs)) out[String(r.id)] = revNameOf(r.id, revs);
  return out;
}

// ── which revision page a sheet was cut from ─────────────────────────────
//
// metadata.sheet_origin = { mainPage(str): [rev_id, rev_page, date?] }
//
// A sheet a revision ADDED is that revision's page, promoted into the set.
// [2], the revision's date, is stamped when the sheet is made (3.05) and is
// absent on files from 2.97–3.04 — read it as optional everywhere.

/** Python's int() of a JSON value: {ok, n}. */
export function pyInt(v) {
  if (typeof v === 'boolean') return { ok: true, n: v ? 1 : 0 };
  if (typeof v === 'number') {
    return Number.isFinite(v) ? { ok: true, n: Math.trunc(v) } : { ok: false, n: 0 };
  }
  if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) {
    return { ok: true, n: parseInt(v, 10) };
  }
  return { ok: false, n: 0 };
}

/** Python's str() of a JSON scalar: None, True and False by their names. */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return String(v);
}

/** The raw sheet_origin entry for one main page, or undefined. */
export function originOf(page, origins) {
  const o = (origins || {})[String(page)];
  return (o === undefined || o === null) ? undefined : o;
}

/** [rev_id, rev_page] of a sheet's origin, or null when it is unreadable. */
export function originPair(page, origins) {
  const o = originOf(page, origins);
  if (!o || !Array.isArray(o) || o.length < 2) return null;
  const rp = pyInt(o[1]);
  if (!rp.ok) return null;
  return [pyStr(o[0]), rp.n];
}

/**
 * The date of the revision a promoted sheet came from (desktop
 * `_origin_date`): the live revision's, so re-dating it re-ranks the sheet;
 * once it is gone, the date stamped on the sheet when it was made.
 */
export function originDateOf(page, origins, revs) {
  const o = originOf(page, origins);
  if (!o || !Array.isArray(o) || !o.length) return '';
  const rid = pyStr(o[0]);
  for (const r of liveRevisions(revs)) {
    if (String(r.id) === rid) return r.date || '';
  }
  return o.length > 2 ? String(o[2] || '') : '';
}

/**
 * {page: [rev_id, rev_page, date]} for every promoted sheet (desktop
 * `_origin_map`), dated from the FULL revision list so hiding or archiving
 * the revision changes nothing. A value that is not a 2- or 3-array, or
 * whose [1] is not an integer, is skipped, never thrown on.
 */
export function originMapOf(origins, revs) {
  const out = {};
  const byId = new Map(liveRevisions(revs).map(r => [String(r.id), r]));
  for (const [k, v] of Object.entries(origins || {})) {
    if (!Array.isArray(v) || v.length < 2) continue;
    const rp = pyInt(v[1]);
    if (!rp.ok) continue;
    const rid = pyStr(v[0]);
    const d = byId.has(rid) ? (byId.get(rid).date || '')
      : (v.length > 2 ? String(v[2] || '') : '');
    out[String(k)] = [rid, rp.n, d];
  }
  return out;
}

/** Set of "rev_id\u0000rev_page" that ARE project sheets. */
export function originPairsOf(origins) {
  const out = new Set();
  for (const v of Object.values(origins || {})) {
    if (!Array.isArray(v) || v.length < 2) continue;
    const rp = pyInt(v[1]);
    if (!rp.ok) continue;
    out.add(`${pyStr(v[0])}\u0000${rp.n}`);
  }
  return out;
}

/**
 * The revision sets the matrix shows and the Current Set chooses from.
 *
 * Hiding or archiving a revision is a way of LOOKING — it takes a column out
 * of the matrix. It is deliberately not the same list that `workingVersionOf`
 * resolves against, which has to see every revision including the hidden ones,
 * because hiding one must not silently move a price.
 *
 * A set with no pages is dropped too. The desktop drops it at load
 * (`if _r["images"]`), so its column never exists there; leaving it in here
 * would shift every column number after it and rank against the wrong index.
 * It can only ever be a record at the END of the list — the file pairs records
 * with blob sets by position, so "no pages" means "past the last set".
 *
 * THE COLUMN INDEX IS AN INDEX INTO THIS LIST, not into metadata.revisions.
 * Everything that ranks, names a column, or reads `cols` counts from here.
 */
export function visibleRevisions(revs) {
  return (revs || []).filter(
    r => r.visible !== false && !r.archived && revPageCount(r) > 0);
}

// ── sheet numbers ────────────────────────────────────────────────────────

/**
 * Compare sheet numbers the way a human does — 'S-2.1', 'S2.1' and 's 2 1'
 * are all the same sheet.
 */
export function normalizeSheetLabel(s) {
  return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * A different, WEAKER normaliser, used only for auto-pairing on import.
 *
 * It folds case and spaces but keeps punctuation, so 'S-2.1' and 'S2.1' stay
 * different sheets here while `normalizeSheetLabel` calls them the same. Both
 * exist in the desktop and they are not interchangeable: matching is
 * deliberately stricter than comparing.
 */
export function normSheet(s) {
  return String(s == null ? '' : s).trim().toUpperCase().replace(/\s+/g, '');
}

// ── dates and ranking ────────────────────────────────────────────────────

const REV_DATE_RE = /^\s*(\d{1,4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,4})\s*$/;

/**
 * Turn a hand-typed revision date into [y, m, d], or null.
 *
 * Accepts 07/24/2026, 3-4-2026 and 2026-08-19. A date nobody can read is not
 * guessed at — it comes back null and that revision ranks oldest, which is the
 * direction that cannot silently promote the wrong sheet into a bid.
 */
export function parseRevisionDate(s) {
  const m = REV_DATE_RE.exec(String(s == null ? '' : s));
  if (!m) return null;
  const a = parseInt(m[1], 10), b = parseInt(m[2], 10), c = parseInt(m[3], 10);
  let y, mo, d;
  if (a > 31) { y = a; mo = b; d = c; }       // 2026-08-19
  else { mo = a; d = b; y = c; }              // 07/24/2026 · 3-4-2026
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return [y, mo, d];
}

// Every rank is [hasDate, [y, m, d], column], so a revision with no readable
// date can never outrank a dated one by accident — and the ORIGINAL, at -1,
// ranks below both. Note what that means: an UNDATED revision still beats the
// original drawing. That is the desktop's rule, and it is the safe direction —
// a set that was reissued is newer than one that was not, whatever the typist
// left out.
export const ORIGINAL_RANK = [-1, [0, 0, 0], -1];

/** How new a revision is. Bigger wins. `col` indexes the VISIBLE revisions. */
export function revisionRank(rev, col, order = 'date') {
  if (order === 'column') return [0, [0, 0, 0], col];
  const d = parseRevisionDate(rev && rev.date);
  return d ? [1, d, col] : [0, [0, 0, 0], col];
}

/** Tuple comparison, the way Python compares the rank tuples. */
export function compareRank(a, b) {
  if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    if (a[1][i] !== b[1][i]) return a[1][i] < b[1][i] ? -1 : 1;
  }
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  return 0;
}

/**
 * The name a revision goes by where only the visible columns are at hand
 * (desktop `_rev_name`): the job's own name for it (`names`, {rev_id: name},
 * from revisionNamesOf) when the caller has it — every caller in the app does
 * — else its description or its column.
 */
export function revName(rev, col, names = null) {
  if (names) {
    const nm = names[String((rev || {}).id)];
    if (nm) return nm;
  }
  return ((rev && rev.description) || '').trim() || `Revision ${col + 1}`;
}

/** The sheet number printed on one page of a revision set. */
export function revPageLabel(rev, rp) {
  const labels = (rev && rev.page_labels) || [];
  return (rp >= 0 && rp < labels.length ? labels[rp] : '') || '';
}

// ── pairing a revision's pages with the original sheets ──────────────────

/**
 * Auto-pair revision pages with main pages by sheet number.
 *
 * Returns {mainIndexAsString: revPageIndex} — note the direction, which is the
 * one the file stores: the KEY is the original sheet, the VALUE is the page of
 * the revision that reissues it. Getting this backwards reads every match map
 * in every existing project inside out.
 *
 * Falls back to positional pairing when no labels match at all, which is what
 * an unlabelled scan of a drawing set leaves you with.
 */
export function autoMatchPages(mainLabels, revLabels) {
  const revBy = new Map();
  (revLabels || []).forEach((rl, j) => {
    const n = normSheet(rl);
    if (n && !revBy.has(n)) revBy.set(n, j);
  });
  const match = {};
  const used = new Set();
  (mainLabels || []).forEach((ml, i) => {
    const n = normSheet(ml);
    const j = revBy.get(n);
    if (n && j !== undefined && !used.has(j)) {
      match[String(i)] = j;
      used.add(j);
    }
  });
  if (!Object.keys(match).length) {
    const n = Math.min((mainLabels || []).length, (revLabels || []).length);
    for (let i = 0; i < n; i++) match[String(i)] = i;
  }
  return match;
}

// ── the versions of one sheet ────────────────────────────────────────────

/**
 * Every version of one sheet, oldest first, as
 * [{revId, label, date, description, rev, revPage, col}].
 *
 * The original is revId '' and rev null. Order matches the revision matrix,
 * which is list order and NOT date order — the matrix is an arrangement, the
 * ranking is a judgement, and they are allowed to disagree.
 *
 * `origins` is metadata.sheet_origin. The page a sheet was CUT FROM is the
 * sheet's own drawing, not another version of it: without the skip a sheet a
 * revision added reads as having "1 newer version" of itself, and the Newest
 * view puts a byte-identical copy of it up as a revision (desktop
 * `sheet_versions`). Each version is labelled with the revision's ONE name.
 */
export function sheetVersions(page, revs, origins = null) {
  const out = [{
    revId: '', label: 'ORIGINAL', date: '', description: '',
    rev: null, revPage: page, col: 0,
  }];
  const org = originOf(page, origins);
  visibleRevisions(revs).forEach((rev, c) => {
    const rp = (rev.match || {})[String(page)];
    if (rp === undefined || rp === null || !(rp >= 0 && rp < revPageCount(rev))) return;
    if (org && Array.isArray(org) && org.length >= 2
        && String(rev.id) === pyStr(org[0]) && rp === org[1]) return;
    out.push({
      revId: String(rev.id),
      label: revNameOf(rev.id, revs),
      date: rev.date || '',
      description: rev.description || '',
      rev, revPage: rp, col: c + 1,
    });
  });
  return out;
}

/**
 * {own, ranked} for one sheet (desktop `_sheet_ranks`): the rank of the
 * sheet's OWN drawing, and [rank, revId] for every other drawing of it.
 *
 * A sheet promoted out of a revision IS that revision's drawing, so its own
 * drawing ranks as that revision — by the live revision's date when it is
 * still in the job, by the date stamped on the sheet once it is deleted, by
 * its column under column order. Every unknown falls back to ORIGINAL_RANK,
 * which is what shipped: nothing here can pin a sheet to its own drawing.
 */
export function sheetRanks(page, revs, order = 'date', origins = null) {
  const vis = visibleRevisions(revs);
  const opair = originPair(page, origins);
  const ranked = [];
  vis.forEach((rev, c) => {
    const rp = (rev.match || {})[String(page)];
    if (rp === undefined || rp === null || !(rp >= 0 && rp < revPageCount(rev))) return;
    if (opair && String(rev.id) === opair[0] && rp === opair[1]) return;
    ranked.push([revisionRank(rev, c, order), String(rev.id)]);
  });
  let own = ORIGINAL_RANK;
  if (opair) {
    const ocol = vis.findIndex(r => String(r.id) === opair[0]);
    if (order === 'column') {
      if (ocol >= 0) own = revisionRank(vis[ocol], ocol, order);
    } else {
      const od = parseRevisionDate(originDateOf(page, origins, revs));
      if (od) own = [1, od, ocol >= 0 ? ocol : -1];
    }
  }
  return { own, ranked };
}

/**
 * The rev_id of the newest version of a sheet, by the SAME rule the Current
 * Set uses. Two answers to "which drawing is current" is a wrong sheet in a
 * bid, so there is only one rule and this is it.
 *
 * '' means the sheet's own drawing. A sheet a revision ADDED ranks as the
 * revision it came from (sheetRanks), so an OLDER revision's page of the
 * same number paired to it can no longer call itself the newest drawing —
 * which is what made the web lock the added sheet's own drawing read-only.
 */
export function newestVersionOf(page, revs, order = 'date', origins = null) {
  if (sheetVersions(page, revs, origins).length <= 1) return '';
  const { own, ranked } = sheetRanks(page, revs, order, origins);
  let best = '';
  let bestRank = own;
  for (const [rank, vid] of ranked) {
    if (compareRank(rank, bestRank) > 0) { best = vid; bestRank = rank; }
  }
  return best;
}

/**
 * Which version of a sheet COUNTS towards the totals.
 *
 * Read out of metadata and nowhere else. It is not "the newest", not "the one
 * with work on it", and not "the one on screen": drawing something must never
 * move a price, and neither must looking at something.
 *
 * Resolved against EVERY revision, hidden and archived included, because
 * hiding a revision is a way of looking. A revision that has been deleted, or
 * whose match to this sheet is gone, falls back to the sheet's own drawing.
 *
 * Absent means the original, so every project made before this feature keeps
 * the totals it has always had.
 */
export function workingVersionOf(page, revs, sheetVersionMap) {
  const rid = String((sheetVersionMap || {})[String(page)] || '');
  if (!rid) return '';
  // Against the revisions the DESKTOP has: a record whose pages the file
  // does not carry is not a revision there, and a sheet booked to one
  // counts from its own drawing.
  for (const rev of liveRevisions(revs)) {
    if (String(rev.id) === rid
        && (rev.match || {})[String(page)] !== undefined
        && (rev.match || {})[String(page)] !== null) return rid;
  }
  return '';
}

/**
 * Which page of `revId` stands in for `page` right now, or null.
 *
 * Re-pairing the matrix can move which page of a revision stands in for a
 * sheet, so this is asked fresh rather than remembered.
 */
export function revPageOf(page, revId, revs) {
  // desktop `rev_page_of`: the pairing as it is written, no bounds test --
  // a counting question must be asked of exactly what the desktop reads.
  const rid = String(revId || '');
  for (const rev of liveRevisions(revs)) {
    if (String(rev.id) !== rid) continue;
    const rp = (rev.match || {})[String(page)];
    return (rp === undefined || rp === null) ? null : rp;
  }
  return null;
}

/**
 * Was this item traced on the drawing `revId` shows for `page` NOW?
 *
 * Re-pairing the matrix can move which page of a revision stands in for a
 * sheet. The quantity still belongs to the page it was traced on, so after a
 * swap it is neither painted nor printed over the page that took its place.
 */
export function itemOnDrawing(page, revId, item, revs) {
  const rp = item && item.rev_page;
  if (rp === undefined || rp === null) return true;
  const n = pyInt(rp);
  if (!n.ok) return true;
  const now = revPageOf(page, revId, revs);
  return now !== null && Number(now) === n.n;
}

/** The rev_id an item was traced on. '' is the sheet's own drawing. */
export function itemRevId(item) {
  return String((item && item.rev_id) || '');
}

/**
 * Whether an item belongs to the drawing currently on screen.
 *
 * The takeoff belongs to the sheet AND to the version of it that was under the
 * pencil. Painting an item over a DIFFERENT version of that drawing would put
 * a measurement on lines it was never taken from, which is the one thing a set
 * of drawings must never do — so the work of every OTHER version is hidden,
 * not the work of all of them. Browsing a revision that was taken off shows
 * that revision's own items.
 *
 * A version is not one drawing, it is a set of them, and the matrix can
 * re-pair which of its pages stands in for this sheet. So the test is the PAGE
 * of the version, not the version alone: after a swap, work traced on page 5
 * must not be painted over page 7. An item with no `rev_page` predates that
 * being stamped and reads back unchanged.
 *
 * `viewingRevPage` is null when the sheet's own drawing is up.
 */
export function onThisVersion(item, viewingRevId, viewingRevPage, markOf = null) {
  // A callout pin or a text note is asked of the drawing it is SHOWN on
  // (markOf -> CountingModel.markVersion): its stamp while the sheet still
  // has that drawing, the sheet's own drawing once it does not -- a pin on a
  // hidden or deleted revision must not become a pin nobody can reach.
  let rid = itemRevId(item);
  let rp = item && item.rev_page;
  if (rid && markOf && KEPT_MARK_TYPES.has(item && item.type)) {
    [rid, rp] = markOf(item);
  }
  if (rid !== String(viewingRevId || '')) return false;
  if (rp === undefined || rp === null || viewingRevPage === null
      || viewingRevPage === undefined) return true;
  const a = pyInt(rp), b = pyInt(viewingRevPage);
  if (!a.ok || !b.ok) return true;
  return a.n === b.n;
}

/** The items on a page that belong to the drawing on screen. */
export function versionItems(items, viewingRevId, viewingRevPage, markOf = null) {
  return (items || []).filter(m => onThisVersion(m, viewingRevId, viewingRevPage, markOf));
}

/** The marks he puts on a drawing to READ it by (desktop KEPT_MARK_TYPES). */
export const KEPT_MARK_TYPES = new Set(['page_ref', 'textnote']);

/**
 * Whether takeoff may be traced on the drawing on screen.
 *
 * The scale belongs to the SHEET, and the sheet's calibration is in pixels of
 * the sheet's own image. A revision reissued at another sheet size has a
 * different number of pixels to the foot, so a length traced on it would be
 * stored against a scale it was never measured with — a wrong number, quietly.
 * Revisions render at the project's own dpi, so a reissue on the same paper is
 * pixel-identical and this is true; only a genuine paper-size change fails it.
 */
export function sizesMatch(sheetSize, revSize) {
  if (!sheetSize || !revSize) return true;
  return Math.abs(revSize.width - sheetSize.width) <= 2
    && Math.abs(revSize.height - sheetSize.height) <= 2;
}

/** Why nothing may be traced here, in the estimator's own terms. */
export function sizeRefusal(sheetSize, revSize) {
  const sw = Math.round((revSize && revSize.width) || 0);
  const sh = Math.round((revSize && revSize.height) || 0);
  const pw = Math.round((sheetSize && sheetSize.width) || 0);
  const ph = Math.round((sheetSize && sheetSize.height) || 0);
  return 'This revision was reissued at a different sheet size '
    + `(${sw}×${sh} against ${pw}×${ph} pixels at this job's dpi). `
    + 'The scale is the sheet’s, measured on the sheet’s own drawing, '
    + 'so anything traced here would come out at the wrong length.';
}

/**
 * {revId: how many items} on one sheet. A group's child is not an item, and
 * a note, a callout, a ruler or a reference line is not takeoff.
 */
export function itemsByVersion(items) {
  const out = {};
  for (const m of items || []) {
    if (!isTakeoffType(m)) continue;
    if (m.group_child) continue;
    const rid = itemRevId(m);
    out[rid] = (out[rid] || 0) + 1;
  }
  return out;
}

/**
 * The short name of a version, for a status line.
 *
 * '' is the sheet's own drawing, and an id no revision answers to is one that
 * was removed from the project while its takeoff was still filed under it —
 * which is worth saying out loud rather than showing as a blank.
 */
export function revisionLabel(revId, revs) {
  // The revision's ONE name (desktop `revision_label` -> `rev_name`), with
  // "(hidden)" after a hidden or archived one.
  return revNameOf(revId, revs, true);
}

// ── what is takeoff ──────────────────────────────────────────────────────

/** Types drawn on a sheet that are in no total (desktop NON_TAKEOFF_TYPES). */
export const NON_TAKEOFF = new Set(['textnote', 'page_ref', 'pitch', 'group', 'ref_distance']);

/** The Measure ruler: a reading, not takeoff (desktop READING_TYPES). */
export const READING_TYPES = new Set(['distance']);

/**
 * Can this item carry a quantity into the bid? (desktop `is_takeoff_item`)
 *
 * The one answer to the one question. A run of a multi-sheet item IS takeoff
 * here; whether a reader counts runs or whole items is that reader's own
 * question.
 */
export function isTakeoffType(m) {
  return !!m && typeof m === 'object' && !Array.isArray(m)
    && !NON_TAKEOFF.has(m.type || '') && !READING_TYPES.has(m.type || '');
}

// ── the row plan: original sheets, inserted rows, orphans ────────────────

/**
 * The rows of the revision matrix, in order.
 *
 * Original sheets in their own order, with any inserted "new sheet" row
 * dropped in where `extra_sheets` says it goes. A slot with `after: -1` sits
 * before the first sheet; `after: i` sits directly after sheet i.
 *
 * `bound` is the set of slot ids some visible revision actually fills. A slot
 * nothing fills is not shown — it would be a row of empty cells.
 */
export function rowPlan(mainLabels, extraSheets, revs, boundIds = null) {
  let bound = boundIds;
  if (!bound) {
    bound = new Set();
    for (const r of revs || []) {
      for (const k of Object.keys(r.extra || {})) bound.add(k);
    }
  }
  const byAfter = new Map();
  for (const s of extraSheets || []) {
    if (!bound.has(s.id)) continue;
    let a = parseInt(s.after, 10);
    if (!Number.isFinite(a)) a = -1;
    if (!byAfter.has(a)) byAfter.set(a, []);
    byAfter.get(a).push(s);
  }
  const plan = (byAfter.get(-1) || []).map(s => ({ kind: 'slot', slot: s }));
  for (let i = 0; i < (mainLabels || []).length; i++) {
    plan.push({ kind: 'main', index: i });
    for (const s of byAfter.get(i) || []) plan.push({ kind: 'slot', slot: s });
  }
  return plan;
}

/**
 * Work out the newest version of every sheet number in the set.
 *
 * Mirrors the revision matrix exactly — original sheets in their order,
 * inserted "new sheet" rows where the panel shows them, and any revision page
 * still unmatched at the bottom. Returns {rows, notes}; each row says which
 * sheet it is, where the page came from and why that one won, so the choice
 * can be shown before anything is printed from it.
 *
 * `revs` must already be the VISIBLE set — the column index is an index into
 * it, and feeding the full list in would rank by the wrong column.
 *
 * Row shape: {sheet, source, date, from, versions, kind, cols, usedCol} where
 * `from` is ['main', i] or ['rev', col, revPage], `cols` maps column number to
 * the same, and `kind` is 'main' | 'slot' | 'new'.
 */
export function resolveLatestSheets(mainLabels, extraSheets, revs, opts = {}) {
  const order = opts.order || 'date';
  const includeNew = opts.includeNew !== false;
  const names = opts.names || null;
  // Revisions he has unticked are SKIPPED as candidates, never removed from
  // the list: under column order the column index IS the rank.
  const skip = new Set((opts.excludeIds || []).map(String));
  // Which drawing each sheet WAS CUT FROM: {page: [rev_id, rev_page, date]}
  // (originMapOf -- dated from the full revision list). A sheet promoted out
  // of a revision IS that drawing: the pair is not a version of it, its own
  // drawing ranks as that revision, and the page is not loose.
  const orgMap = {};
  for (const [k, v] of Object.entries(opts.origins || {})) {
    if (!Array.isArray(v) || v.length < 2) continue;
    const rp = pyInt(v[1]);
    if (!rp.ok) continue;
    orgMap[String(k)] = [pyStr(v[0]), rp.n, v.length > 2 ? v[2] : ''];
  }
  const orgPairs = new Set(Object.values(orgMap).map(o => `${o[0]}\u0000${o[1]}`));
  const rows = [];

  const bound = new Set();
  for (const r of revs || []) {
    if (skip.has(String(r.id))) continue;
    for (const k of Object.keys(r.extra || {})) bound.add(k);
  }

  for (const step of rowPlan(mainLabels, extraSheets, revs, bound)) {
    // Column 0 is the ORIGINAL set; revision c sits in column c + 1, the same
    // way the matrix on screen reads.
    const cands = [];
    let sheet;
    if (step.kind === 'main') {
      const i = step.index;
      sheet = (mainLabels[i] || '').trim() || `Page ${i + 1}`;
      const oe = orgMap[String(i)];
      let own = ORIGINAL_RANK;
      if (oe) {
        const oc = (revs || []).findIndex(r => String(r.id) === oe[0]);
        if (order === 'column') {
          if (oc >= 0) own = revisionRank(revs[oc], oc, order);
        } else {
          const od = parseRevisionDate(oe[2]);
          if (od) own = [1, od, oc >= 0 ? oc : -1];
        }
      }
      cands.push({ rank: own, src: 'ORIGINAL', date: '', where: ['main', i], col: 0 });
      (revs || []).forEach((rev, c) => {
        if (skip.has(String(rev.id))) return;
        const rp = (rev.match || {})[String(i)];
        if (rp === undefined || rp === null || !(rp >= 0 && rp < revPageCount(rev))) return;
        if (oe && String(rev.id) === oe[0] && rp === oe[1]) return;  // THIS sheet IS that drawing
        cands.push({
          rank: revisionRank(rev, c, order), src: revName(rev, c, names),
          date: rev.date || '', where: ['rev', c, rp], col: c + 1,
        });
      });
    } else {
      const slot = step.slot;
      sheet = (slot.label || '').trim() || 'NEW SHEET';
      (revs || []).forEach((rev, c) => {
        if (skip.has(String(rev.id))) return;
        const rp = (rev.extra || {})[slot.id];
        if (rp === undefined || rp === null || !(rp >= 0 && rp < revPageCount(rev))) return;
        cands.push({
          rank: revisionRank(rev, c, order), src: revName(rev, c, names),
          date: rev.date || '', where: ['rev', c, rp], col: c + 1,
        });
      });
      if (!cands.length) continue;          // an empty row exports nothing
    }

    // Python's max() keeps the FIRST maximum, so only a STRICTLY greater
    // candidate displaces the one in hand.
    let best = cands[0];
    for (const c of cands) if (compareRank(c.rank, best.rank) > 0) best = c;

    const cols = {};
    for (const c of cands) cols[c.col] = c.where;
    rows.push({
      sheet, source: best.src, date: best.date, from: best.where,
      versions: cands.length, kind: step.kind, cols, usedCol: best.col,
    });
  }

  // Revision pages nobody has paired with a sheet yet. Leaving them out would
  // quietly drop a sheet the architect issued, so they go in — one per sheet
  // number, newest, same rule as everything else.
  let orphans = 0;
  if (includeNew) {
    const byLabel = new Map();
    const loose = [];
    (revs || []).forEach((rev, c) => {
      if (skip.has(String(rev.id))) return;
      // A page a project SHEET was cut from is not loose: the sheet is that
      // drawing, and it is already in the set above as a main row.
      const used = new Set([
        ...Object.values(rev.match || {}),
        ...Object.values(rev.extra || {}),
      ]);
      for (let rp = 0; rp < revPageCount(rev); rp++) {
        if (used.has(rp)) continue;
        if (orgPairs.has(`${String(rev.id)}\u0000${rp}`)) continue;
        const lbl = revPageLabel(rev, rp).trim();
        const ent = {
          rank: revisionRank(rev, c, order), src: revName(rev, c, names),
          date: rev.date || '', where: ['rev', c, rp], lbl,
        };
        if (lbl) {
          const key = normalizeSheetLabel(lbl);
          const prev = byLabel.get(key);
          if (!prev || compareRank(ent.rank, prev.rank) > 0) byLabel.set(key, ent);
        } else {
          loose.push(ent);
        }
      }
    });
    for (const ent of [...byLabel.values(), ...loose]) {
      orphans += 1;
      rows.push({
        sheet: ent.lbl || `(unnamed p.${ent.where[2] + 1})`,
        source: ent.src, date: ent.date, from: ent.where,
        versions: 1, kind: 'new',
        cols: { [ent.where[1] + 1]: ent.where },
        usedCol: ent.where[1] + 1,
      });
    }
  }

  // Two rows carrying the same sheet number means the set's page numbers need
  // attention — the export is still right, each row is a real page, but the
  // reader deserves to know before printing it.
  const seen = new Set();
  const dupes = new Set();
  for (const r of rows) {
    const key = normalizeSheetLabel(r.sheet);
    if (key && seen.has(key)) dupes.add(r.sheet);
    seen.add(key);
  }

  const notes = {
    sheets: rows.length,
    from_revisions: rows.filter(r => r.from[0] === 'rev').length,
    unmatched: orphans,
    duplicates: [...dupes].sort(),
    undated: (revs || []).filter(r => !skip.has(String(r.id))
      && !parseRevisionDate(r.date)).length,
  };
  return { rows, notes };
}

// ── keeping the model straight when the page list changes ────────────────

/** A mapper for `count` sheets inserted at `at`: k -> k + count from `at` on. */
export function insertMapper(at, count) {
  return k => (k >= at ? k + count : k);
}

/** A mapper for the sheet at `index` removed: it is gone, later ones move up. */
export function deleteMapper(index) {
  return k => (k === index ? null : (k > index ? k - 1 : k));
}

function remapKeyed(dict, mapper) {
  const out = {};
  for (const [k, v] of Object.entries(dict || {})) {
    const i = pyInt(k);
    if (!i.ok) continue;
    const nk = mapper(i.n);
    if (nk !== null && nk !== undefined) out[String(nk)] = v;
  }
  return out;
}

/** desktop `_remap_anchor`: the sheet a record follows, or the nearest above. */
function remapAnchor(after, mapper) {
  const a0 = pyInt(after);
  if (!a0.ok) return -1;
  for (let a = a0.n; a >= 0; a -= 1) {
    const na = mapper(a);
    if (na !== null && na !== undefined) return na;
  }
  return -1;
}

/** A callout pin's target, moved with its sheet: -1 when the sheet is gone. */
function remapRefPage(m, mapper) {
  if (!m || typeof m !== 'object' || m.type !== 'page_ref') return;
  if (!Object.prototype.hasOwnProperty.call(m, 'ref_page')) return;
  const rp = pyInt(m.ref_page === undefined || m.ref_page === null ? -1 : m.ref_page);
  if (!rp.ok || rp.n < 0) return;
  const nrp = mapper(rp.n);
  m.ref_page = (nrp === null || nrp === undefined) ? -1 : nrp;
}

/**
 * Move every page index the job keeps — the KEYS of every record filed by
 * sheet, and the indices stored INSIDE records — after the main page list
 * changed. `mapper(oldIndex)` is the new index, or null when that sheet is
 * gone. The port of the desktop's `_remap_revision_matches` (the one funnel
 * every insert, reorder, copy and delete there goes through), key for key,
 * plus the per-sheet dicts the desktop moves beside it.
 *
 * Left behind, any one of these hands one sheet's record to whichever sheet
 * landed on its number. For `sheet_origin` that was not cosmetic: a delete
 * here left the ADDED sheet's origin on the original sheet that slid into its
 * row, and the desktop's Delete Revision then deleted that ORIGINAL sheet as
 * "the sheet it added". Its value — [rev_id, rev_page, date] — holds no main
 * index and travels whole, the date included.
 *
 * `measurements` is walked for callout pins: a pin names its target sheet by
 * index INSIDE the item, which no re-keying of the buckets reaches. A pin
 * whose target is deleted is kept and pointed nowhere (-1), as the desktop
 * does: it is a mark he made on a sheet he kept.
 */
export function remapPageIndices(md, measurements, mapper, { reordered = false } = {}) {
  if (!md) return;
  for (const rev of md.revisions || []) {
    rev.match = remapKeyed(rev.match, mapper);
  }
  if (md.sheet_version && Object.keys(md.sheet_version).length) {
    md.sheet_version = remapKeyed(md.sheet_version, mapper);
    // Absent means "the sheet's own drawing", so an emptied book is the same
    // statement as no book — and leaving no key keeps a file that never had
    // one exactly as it was.
    if (!Object.keys(md.sheet_version).length) delete md.sheet_version;
  }
  // page_groups: the desktop's shape is a LIST of {id, name, pages: [...]},
  // each holding page indices INSIDE it. An older build of this app wrote an
  // empty {} here, which the desktop reads as no groups; that shape is left
  // as it is.
  if (Array.isArray(md.page_groups) && md.page_groups.length) {
    const out = [];
    for (const g of md.page_groups) {
      if (!g || typeof g !== 'object') continue;
      const pages = [];
      for (const i of g.pages || []) {
        const n = pyInt(i);
        if (!n.ok) continue;
        const ni = mapper(n.n);
        if (ni !== null && ni !== undefined) pages.push(ni);
      }
      if (pages.length) {
        out.push({ ...g, pages: [...new Set(pages)].sort((a, b) => a - b) });
      }
    }
    md.page_groups = out;
  }
  // Inserted rows hang off a sheet: the anchor moves with it, and a deleted
  // anchor falls back to the sheet above.
  for (const s of md.extra_sheets || []) {
    const a = pyInt(s.after === undefined ? -1 : s.after);
    const av = a.ok ? a.n : -1;
    if (av < 0) { s.after = -1; continue; }
    const na = mapper(av);
    s.after = (na === null || na === undefined) ? av - 1 : na;
  }
  for (const key of ['page_titles', 'sheet_origin']) {
    if (md[key] && Object.keys(md[key]).length) md[key] = remapKeyed(md[key], mapper);
  }
  if (md.page_overlays && Object.keys(md.page_overlays).length) {
    const out = {};
    for (const [k, st0] of Object.entries(md.page_overlays)) {
      const i = pyInt(k);
      if (!i.ok) continue;
      const nk = mapper(i.n);
      if (nk === null || nk === undefined) continue;
      let st = st0;
      if (st && typeof st === 'object'
          && (st.rev_id === undefined || st.rev_id === null)
          && Object.prototype.hasOwnProperty.call(st, 'overlay_page')) {
        const op0 = pyInt(st.overlay_page);
        const op = op0.ok ? mapper(op0.n) : null;
        if (op === null || op === undefined) continue;   // compared sheet gone
        st = { ...st, overlay_page: op };
      }
      out[String(nk)] = st;
    }
    md.page_overlays = out;
  }
  const kept = [];
  for (const p of md.revisions_pending_images || []) {
    if (!p || typeof p !== 'object') continue;
    if (p.match && Object.keys(p.match).length) p.match = remapKeyed(p.match, mapper);
    for (const r of p.kept_sheets || []) if (r && typeof r === 'object') kept.push(r);
  }
  for (const r of md.sheets_kept_aside || []) if (r && typeof r === 'object') kept.push(r);
  for (const rec of kept) {
    if ('after' in rec) rec.after = remapAnchor(rec.after, mapper);
    for (const m of rec.measurements || []) remapRefPage(m, mapper);
  }
  for (const lst of Object.values(measurements || {})) {
    if (!Array.isArray(lst)) continue;
    for (const m of lst) remapRefPage(m, mapper);
  }
  // The per-sheet dicts the desktop moves beside the funnel: the reader's
  // doubt about a sheet number, the detail map read off a sheet, and what a
  // look at a sheet saw -- each read as evidence about THAT sheet.
  for (const key of ['page_label_conf', 'detail_maps', 'vision_callouts']) {
    if (md[key] && typeof md[key] === 'object' && !Array.isArray(md[key])
        && Object.keys(md[key]).length) {
      md[key] = remapKeyed(md[key], mapper);
      if (key === 'detail_maps' && !Object.keys(md[key]).length) delete md[key];
    }
  }
  // After a page move the source PDF no longer stands for this project's
  // page numbers (desktop `_reindex_detail_maps`).
  if (reordered) md.pages_rearranged = true;
}

/**
 * Shift every page-index reference in the revision model after an insert or
 * a delete.
 *
 * `match` is keyed by main page index and `extra_sheets[].after` is a main
 * page index, so both move when a sheet is added or removed. `sheet_version`
 * is keyed the same way. Left behind, a reorder hands one sheet's chosen
 * version to whichever sheet landed on its number — and with it, the takeoff
 * that counts.
 *
 * `at` is the index inserted at or removed; `delta` is +1 or -1. On a delete
 * the entry FOR that page is dropped, not shifted.
 */
export function shiftRevisionIndices(revs, extraSheets, sheetVersionMap, at, delta) {
  for (const rev of revs || []) {
    const next = {};
    for (const [k, v] of Object.entries(rev.match || {})) {
      const i = parseInt(k, 10);
      if (!Number.isFinite(i)) continue;
      if (delta < 0 && i === at) continue;           // that sheet is gone
      next[String(i >= at ? i + delta : i)] = v;
    }
    rev.match = next;
  }
  for (const s of extraSheets || []) {
    let a = parseInt(s.after, 10);
    if (!Number.isFinite(a)) a = -1;
    // `after` names the sheet a slot follows, so it moves with that sheet.
    // A slot following the deleted sheet follows the one before it instead;
    // the row survives, because the revision page in it is still real.
    if (delta < 0 && a === at) s.after = at - 1;
    else if (a >= at) s.after = a + delta;
  }
  if (sheetVersionMap) {
    const next = {};
    for (const [k, v] of Object.entries(sheetVersionMap)) {
      const i = parseInt(k, 10);
      if (!Number.isFinite(i)) continue;
      if (delta < 0 && i === at) continue;
      next[String(i >= at ? i + delta : i)] = v;
    }
    for (const k of Object.keys(sheetVersionMap)) delete sheetVersionMap[k];
    Object.assign(sheetVersionMap, next);
  }
}

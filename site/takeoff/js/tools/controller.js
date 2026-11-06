// controller.js — every tool's click, preview, finish and write.
//
// One controller owns the canvas's pointer and keyboard input and decides what
// the current tool does with it. Tools do not own state of their own; the
// in-progress point list lives here, so cancelling, undoing a vertex and
// switching tools are all one code path.
//
// THINGS THAT LOOK LIKE OVERSIGHTS AND ARE NOT:
//
//  · Pitch is the one point-collecting tool with NO shift constraint. It reads
//    a slope off a drawing; constraining the cursor to 45° would quantise the
//    very thing being measured.
//  · Polyline shows the snap-to-first highlight but never closes on it. A run
//    of wall is open by nature, and auto-closing it added a leg nobody drew.
//  · Distance and pitch open no dialog and get no sort_order. They are
//    rulers — they answer a question and are not part of the estimate.
//  · Calibrate writes no measurement at all. It only changes the sheet scale.

import {
  constrainTo45, pxDist, pathLength, polygonArea, perimeter, pointInPolygon,
  distToSegment, boundingBox, pointsAlongPath,
} from '../core/geom.js';
import { recompute, isAreaType } from '../core/measure.js';
import {
  ppfFromCalibration, formatFt, formatDistancePrecision,
} from '../core/units.js';
import { nextPaletteColor, peekPaletteColor } from '../render/theme.js';
import { STANDALONE_PAGE } from '../core/takeoff-file.js';
import { onThisVersion, itemRevId } from '../core/revisions.js';
import { CountingModel, applyBooking } from '../core/counting.js';
import {
  MARKUP_TOOLS, MARKUP_HINTS, MarkupState, beginStroke, extendStroke,
  rectFrom, rectIsWorthKeeping, annotationsUnderEraser, makeTextNote,
  makeCallout, HIGHLIGHT_COLORS, PEN_COLORS,
  DEFAULT_HIGHLIGHT_WIDTH, DEFAULT_PEN_WIDTH, ERASER_RADIUS_PX,
} from './markup.js';

/** The takeoff tools — the ones that produce a quantity. */
export const TAKEOFF_TOOLS = [
  ['pan', 'Pan / Select'],
  ['distance', 'Measure'],
  ['area', 'Area'],
  ['slope_area', 'Slope Roof'],
  ['pitch', 'Pitch'],
  ['polyline', 'Polyline'],
  ['count', 'Count'],
  ['window', 'Windows'],
  ['door', 'Doors'],
  ['linear_count', 'Array'],
  ['grid', 'Grid'],
  ['tile', 'Tile'],
  ['calibrate', 'Calibrate'],
];

export { MARKUP_TOOLS };

/** Every tool, takeoff and markup together. */
export const TOOLS = [...TAKEOFF_TOOLS, ...MARKUP_TOOLS];

/** True for a tool that writes markup rather than takeoff. */
export const isMarkupTool = mode => MARKUP_TOOLS.some(t => t[0] === mode);

/**
 * The tools that can produce a TEMPORARY measurement.
 *
 * These read a drawing rather than taking off from it: a length, an area, a
 * roof pitch. They are the three that make sense with nothing to save — and
 * pitch needs no scale at all, being a ratio.
 *
 * They are the ordinary modes, not special ones. What decides where the
 * result lands is `scratchSink`, so all the geometry, the live preview, the
 * shift-constraint and the hints are the same code in both modes.
 */
export const SCRATCH_CAPABLE = new Set(['distance', 'area', 'pitch']);

/** What to say when a tool is refused and nothing more specific was set. */
const READ_ONLY_DEFAULT =
  'This is View Only mode — switch to Edit Mode to change the takeoff.';

export const HINTS = {
  pan: 'Click an item to select it.\nDrag vertices to reshape. Double-click to edit.',
  distance: 'Click two points to measure.\nHold Shift to constrain to 45° angles.',
  area: 'Click each corner of the area.\nClick the first point or double-click to close.',
  slope_area: 'Trace the roof footprint, then enter the\npitch to get the true sloped surface area.',
  pitch: 'Click two points along a roof slope in an\nelevation to read its pitch (6:12) and angle.\nNo scale needed — pitch is a ratio.',
  polyline: 'Click points along the run.\nDouble-click or Enter to finish.',
  count: 'Click each item on the drawing to count it.\nPick or type a category below.',
  window: 'Click every window location to drop pins.\nThen in Pan mode, double-click each pin\nto enter the window no. and size.',
  door: 'Click every door location to drop pins.\nThen in Pan mode, double-click each pin\nto enter the door no. and size.',
  linear_count: 'Trace a path — items are placed\nautomatically at the spacing below.',
  grid: 'Set the cell size and angle below, then\nclick two corners to place the grid.',
  tile: 'Trace the floor area corner by corner.\nFirst click anchors the pattern; pick tile\nsize, pattern and grout in the dialog.',
  calibrate: 'Draw a line over a known dimension,\nthen enter its true length to set the scale.',
  ...MARKUP_HINTS,
};

const CURSORS = {
  pan: 'grab', distance: 'crosshair', area: 'crosshair', slope_area: 'crosshair',
  pitch: 'crosshair', polyline: 'crosshair', count: 'crosshair', window: 'crosshair',
  door: 'crosshair', linear_count: 'crosshair', grid: 'crosshair', tile: 'crosshair',
  calibrate: 'crosshair',
  draw: 'crosshair', highlight: 'crosshair', highlight_rect: 'crosshair',
  erase: 'cell', textnote: 'crosshair', page_ref: 'crosshair',
};

/** Tools that collect a chain of points before finishing. */
const CHAIN_TOOLS = new Set([
  'area', 'slope_area', 'polyline', 'linear_count', 'grid', 'tile',
]);
/** Tools whose second click finishes them. */
const TWO_CLICK_TOOLS = new Set(['distance', 'pitch', 'calibrate']);
/** Tools that take a 45° constraint while Shift is held. Pitch never does. */
const CONSTRAINED_TOOLS = new Set([
  'area', 'slope_area', 'polyline', 'linear_count', 'distance', 'calibrate',
  'grid', 'tile',
]);
/** Tools whose polygon closes when the cursor snaps back to the first vertex. */
const CLOSING_TOOLS = new Set(['area', 'slope_area', 'grid', 'tile']);

const CATEGORY_DEFAULT_OPENINGS = 'Doors & Windows';

/** How far a finger may slide and still count as a tap, in screen px. */
const TAP_SLOP = 11;
/** A mouse is steadier than a finger: the desktop uses 4px for this. */
const CLICK_SLOP = 4;
/** How long a finger must rest before it means the right mouse button. */
const LONG_PRESS_MS = 500;

export const TILE_PATTERNS = [
  // (id, display label, typical waste %) — the labels print in the items
  // panel, the reports and the workbook, so they are the source's exactly.
  ['grid', 'Straight Grid', 10],
  ['half', 'Running Bond ½', 10],
  ['third', 'Stair-Step ⅓', 10],
  ['herringbone', 'Herringbone', 15],
  ['chevron', 'Chevron', 18],
  ['diagonal', 'Diagonal 45°', 15],
];

export const TILE_SIZE_PRESETS = [
  // (label, w_in, h_in)
  ['1″ × 1″ mosaic', 1.0, 1.0],
  ['2″ × 2″ mosaic', 2.0, 2.0],
  ['3″ × 6″ subway', 6.0, 3.0],
  ['4″ × 4″', 4.0, 4.0],
  ['4″ × 12″ subway', 12.0, 4.0],
  ['6″ × 6″', 6.0, 6.0],
  ['6″ × 24″ plank', 24.0, 6.0],
  ['6″ × 36″ plank', 36.0, 6.0],
  ['8″ × 8″', 8.0, 8.0],
  ['12″ × 12″', 12.0, 12.0],
  ['12″ × 24″', 24.0, 12.0],
  ['16″ × 16″', 16.0, 16.0],
  ['18″ × 18″', 18.0, 18.0],
  ['24″ × 24″', 24.0, 24.0],
  ['24″ × 48″', 48.0, 24.0],
];

export const TILE_GROUT_PRESETS = [
  ['1/16″', 0.0625], ['3/32″', 0.09375], ['1/8″', 0.125],
  ['3/16″', 0.1875], ['1/4″', 0.25], ['3/8″', 0.375], ['1/2″', 0.5],
];

export const TILE_COUNT_CAP = 60000;

export function tilePatternWaste(pattern) {
  const row = TILE_PATTERNS.find(p => p[0] === pattern);
  return row ? row[2] : 10;
}

// Grab radii, in screen pixels, scaled by the UI scale (1.6 in touch mode).
const VERTEX_GRAB = 10;
const EDGE_GRAB = 7;
const PIN_GRAB = 14;
const SNAP_FIRST_RADIUS = 15;
const RMB_PAN_THRESHOLD = 4;

export class ToolController extends EventTarget {
  /**
   * @param {object} deps
   * @param {HTMLCanvasElement} deps.canvas
   * @param {import('../render/viewport.js').Viewport} deps.viewport
   * @param {import('../core/project.js').Project} deps.project
   * @param {() => number} deps.currentPage
   * @param {object} deps.host   callbacks into the app shell (dialogs, status)
   */
  constructor({ canvas, viewport, project, currentPage, host }) {
    super();
    this.canvas = canvas;
    this.viewport = viewport;
    this.project = project;
    this.getCurrentPage = currentPage;
    this.host = host || {};

    this.mode = 'pan';

    /* ── looking at another version of this sheet ──────────────────────
     *
     * `viewingVersion` says which drawing is on screen: rev_id '' with
     * revPage null is the sheet's own. A HIT TEST may only ever see the
     * items belonging to it, and while `readOnly` is set nothing may be
     * placed, moved or deleted at all.
     *
     * The gate is on INTENT, not on the name of the current tool. The
     * desktop learned this the expensive way: its press guard refused tools
     * by mode name and left Pan exempt — and Pan is the mode an estimator
     * sits in all day. Every item the painter had just refused to draw was
     * still grabbable, so a drag moved a real measurement onto a drawing it
     * was never traced on, with neither the item nor its grips on screen to
     * show it, and the next save kept it.
     *
     * So the filter lives in `hitTest`, which selection, vertex dragging,
     * item dragging, hover, the callout press and double-click all go
     * through. Pan, pinch, the wheel and both other mouse buttons stay live,
     * because looking is never refused.
     */
    this.viewingVersion = { revId: '', revPage: null };
    // (item) -> [revId, revPage] of the drawing a callout pin or a text note
    // is SHOWN on (CountingModel.markVersion), set by the app. Without it a
    // pin is asked of its stamp alone, as it always was.
    this.markOf = null;

    /* ── read-only: looking is free, editing is not ────────────────────
     *
     * Set while the app is in View Only mode, and while another version of
     * a sheet is on screen. It draws the line at INTENT:
     *
     *   allowed    pan, pinch, wheel, both other mouse buttons, and
     *              SELECTING an item — clicking a wall to read what it is
     *              is looking, and a viewer that cannot do it is a picture
     *   refused    dragging an item or a vertex, Delete, the nudge arrows,
     *              double-click-to-edit, the item context menu, and every
     *              tool that would put something into the project
     *
     * Note what is NOT here: `hitTest` does not go blank. That was the
     * blunt version. What must not happen is a DRAG, and the drag is armed
     * in one place, so that is where it is stopped.
     */
    this.readOnly = false;

    /**
     * Where a finished measurement goes when it is not going into the
     * project. Set in View Only mode; the item lands in a scratch store
     * that no save can reach, which is what makes a temporary dimension
     * temporary — not a flag on it that something might forget to read.
     * @type {((item: object) => void)|null}
     */
    this.scratchSink = null;

    /**
     * Set while the overlay's Align is on: a drag moves the overlay instead
     * of panning. Receives the movement in SHEET pixels.
     * @type {((dx:number, dy:number) => void)|null}
     */
    this.overlayDrag = null;

    this.uiScale = 1.0;
    this.markerScale = 1.0;
    this.zoomStepPercent = 15;
    this.wheelMode = 'zoom';
    // True when the user's page-nav preset is bound to the arrow keys, so the
    // nudge shortcut steps aside for it.
    this.arrowsNavigatePages = false;

    /** Points placed so far in the live measurement. */
    this.current = [];
    this.cursorPage = null;
    this.constrainedPt = null;
    this.snapToFirst = false;

    this.selected = new Set();
    this.hoverId = null;
    this.hoverVertex = null;
    this.dragVertex = null;

    // Per-tool options, as the options bar sets them.
    this.options = {
      pendingName: '',
      countCategory: '',
      spacingIn: 12,
      gridCellW: 2, gridCellH: 2, gridAngle: 0,
      tileWIn: 12, tileHIn: 12, groutIn: 0.125,
      tilePattern: 'grid', tileAngle: 0,
      precision: '1/2',
    };

    // The live markup being drawn. Kept apart from `current` because a stroke,
    // a box and a note are three different shapes, none of them a point chain.
    this.markup = new MarkupState();
    this.markupStyle = {
      highlightColor: HIGHLIGHT_COLORS[0][1].slice(),
      penColor: PEN_COLORS[0][1].slice(),
      highlightWidth: DEFAULT_HIGHLIGHT_WIDTH,
      penWidth: DEFAULT_PEN_WIDTH,
      noteFontSize: 12,
    };

    // Count arming: the tool asks WHICH item before it is entered, so every
    // click after that just adds a point to the same item.
    this.countTarget = null;
    this.countSpec = null;
    // The answers the armed count was made from, kept past the first tap
    // that spends countSpec: a step that takes the item back off the sheet
    // arms them again (desktop _count_answers). null for a count carried on,
    // which is made again from the item itself (countAnswersAgain).
    this.countAnswers = null;
    // The name the clicks are being counted under: the armed count's, or the
    // Item box's once a click was counted under it (desktop _count_named).
    // A job switch empties the box only while it still shows this name, and
    // a DIFFERENT name in the box starts the next item.
    this.countNamed = '';
    // The counts held on other drawings, oldest first (desktop _count_left):
    // back on a drawing counted on, taps go to the newest one held there.
    // Item objects, found again by _uid after every restore (_rearmCount).
    this.countLeft = [];
    // A Posts/Hardware count (desktop framing) a step took off the sheet:
    // this app cannot make its lumber again, so the next tap asks the form
    // rather than make it again bare -- from its answers or by its name.
    this.countMustAsk = false;
    // Which job this is: one more every time another comes in. A form asked
    // about one job and answered in the next is no answer (_ask).
    this._job = 0;
    // Another job: the count held for the last one is put down.
    this.project.addEventListener('reset', () => this._dropPerProject());
    // Every item object was just replaced -- an undo, a redo, a long press
    // putting a trembled shape back: the count being placed, and the ones
    // held on other drawings, are found again in the store put back.
    this.project.addEventListener('restored', ev => this._rearmCount((ev.detail || {}).before));
    // Anything that moves the history while a press on a shape is held -- a
    // Ctrl+Z, a Ctrl+Y -- ends that press: its release must not then keep,
    // or put back, a picture of the job from before that edit (the
    // desktop's _restore_state ends a drag the same way).
    this.project.addEventListener('history-changed', () => this._dropPress());

    this._panning = false;
    this._panLast = null;
    // Touch. Every live finger is in _pointers; two of them are a pinch.
    // _pendingTap is a finger that has landed in a point-collecting tool and
    // has not yet earned its point.
    this._pointers = new Map();
    this._pinch = null;
    // A press that landed on a callout bubble, waiting to find out on
    // release whether it was a read or a drag.
    this._calloutPress = null;
    this._pendingTap = null;
    this._lpTimer = null;
    this._lpFired = false;
    this._rmbCandidate = null;
    this._rmbPanned = false;
    this._moveDrag = null;
    this._suppressClick = false;

    this._bind();
  }

  // ── mode ────────────────────────────────────────────────────────────

  async setMode(mode, { ask = true } = {}) {
    if (!TOOLS.some(t => t[0] === mode)) return false;
    // Read-only: refuse the TOOL, not just what it would place. A toolbar
    // showing Highlighter as the live tool while every stroke is silently
    // dropped is worse than not offering it — the user concludes the app is
    // broken rather than that the mode is doing its job.
    if (this.readOnly && mode !== 'pan' && !this.isScratchTool(mode)) {
      this.emit('status', { text: this.readOnlyReason || READ_ONLY_DEFAULT });
      return false;
    }
    // The count tool asks which item is being counted BEFORE it is entered.
    // Cancelling the question must leave the previous tool in place.
    if (mode === 'count' && ask) {
      const armed = await this._armCount();
      if (!armed) return false;
    }
    this.cancel();
    const was = this.mode;
    this.mode = mode;
    // Picking up a tool from another tool starts a new item: the Item box
    // is emptied (desktop _sync_tool_options -> clear_name), after the count
    // form has put its name there -- so Count picked up from Pan starts
    // empty, and Count pressed again while counting keeps the armed name.
    // Not said on its own: 'mode-changed' below draws the bar again.
    if (mode !== was) this.options.pendingName = '';
    this.canvas.style.cursor = CURSORS[mode] || 'default';
    this.emit('mode-changed', { mode });
    this.emit('status', { text: HINTS[mode] || '' });
    return true;
  }

  async _armCount() {
    const page = this.getCurrentPage();
    // Only the counts on the drawing on screen (desktop _arm_count_item):
    // one traced on another drawing of the sheet takes no tap from here.
    const existing = (this.project.measurements[page] || [])
      .filter(m => m.type === 'count' && this._onScreen(m));
    const choice = await this._ask(this.host.askCountItem?.({ existing }));
    if (!choice) return false;
    if (choice.continueItem) {
      // Picked from a list made before the form went up; a step taken while
      // it was up replaced every item object, so it is found again.
      const it = this._inStore(choice.continueItem) ? choice.continueItem
        : this._foundAgain(choice.continueItem);
      if (!it) {
        this.emit('status', { text: 'That count is no longer on the sheet — nothing was armed' });
        return false;
      }
      this.armCount(it, null);
      this.emit('status', {
        text: `Carrying on with "${it.name}" — every click adds one`,
      });
    } else {
      this.armCount(null, choice.spec);
      this.emit('status', {
        text: `Counting "${choice.spec.name}" — every click adds one`,
      });
    }
    return true;
  }

  /**
   * What the next count taps belong to (desktop arm_count): `target`, an
   * existing count to carry on with, or `spec`, the answers for a new one,
   * made on the first tap so that arming and changing your mind leaves
   * nothing behind. The answers are kept past that tap (countAnswers), the
   * Item box shows the name (countNamed: what the tool itself put there),
   * and nothing held on another drawing is this choice.
   */
  armCount(target, spec) {
    this.countTarget = target || null;
    this.countSpec = spec ? { ...spec } : null;
    this.countAnswers = this.countSpec;
    this.countMustAsk = false;
    const name = String((target ? target.name : spec && spec.name) || '').trim();
    this._syncToolName(name);
    this.countNamed = name;
    this.countLeft = [];
  }

  /**
   * Nothing armed for the next count click: no item to add to, no answers to
   * start one from, no name kept from the last one, nothing held on another
   * drawing (desktop forget_armed_count). The Item box belongs to the app
   * and is not touched.
   */
  forgetArmedCount() {
    this.countTarget = null;
    this.countSpec = null;
    this.countAnswers = null;
    this.countNamed = '';
    this.countLeft = [];
    this.countMustAsk = false;
    this.options.countCategory = '';
  }

  /**
   * Show in the Item box the name the count really has, so the next tap
   * carries on with it (desktop _sync_tool_name). Said only when it changes:
   * the app draws the whole bar again, and never while he is typing in it.
   */
  _syncToolName(name) {
    const n = String(name || '').trim();
    if (this.options.pendingName === n) return;
    this.options.pendingName = n;
    this.emit('tool-name', { name: n });
  }

  /** Is this very object an item in the store? (identity, not likeness) */
  _inStore(m) {
    if (!m) return false;
    for (const [, it] of this.project.allItems()) if (it === m) return true;
    return false;
  }

  /**
   * The store's own copy of a count, by its runtime _uid. A restore puts a
   * copy of every item back; the copy keeps the _uid, and no other item
   * ever carries it, so this IS that count -- the desktop's likeness
   * ranking (_count_found_again) is not needed here.
   */
  _foundAgain(m) {
    const f = m && m._uid ? this.project.findItem(m._uid) : null;
    return f ? f.item : null;
  }

  /**
   * After a restore (Project 'restored': an undo, a redo, a long press
   * putting a trembled shape back), the count being placed follows onto the
   * store put back (desktop _restore_state -> _rearm_count). `before` is the
   * store the restore threw away.
   *
   * Found again: the taps carry on with the store's own copy. Not there
   * because the step took it off the sheet (Ctrl+Z of its first tap): the
   * answers it was made from are armed again, so the next tap starts it
   * exactly as the first did, with no form; the old object stays armed
   * beside them, so a Ctrl+Y that brings it back finds it. A count carrying
   * the desktop's Posts/Hardware framing is NOT made again: its lumber and
   * hardware cannot be worked out here, so the next tap asks, and the status
   * line says why. The counts held on other drawings are found again too.
   */
  _rearmCount(before) {
    const t = this.countTarget;
    if (t) {
      const found = this._foundAgain(t);
      if (found) {
        this.countTarget = found;
        this.countSpec = null;
        this.countMustAsk = false;
      } else if (storeHolds(before, t)) {
        const answers = countAnswersAgain(t, this.countAnswers);
        this.countAnswers = answers;
        if (pyTruthy(answers.framing)) {
          this.countSpec = null;
          this.countMustAsk = true;
          if (this.mode === 'count') {
            this.emit('status', { text: framedAskWords(t.name, 'taken', 'the next tap') });
          }
        } else {
          this.countSpec = answers;
        }
      }
    }
    const back = [];
    for (const m of this.countLeft) {
      const f = this._foundAgain(m);
      if (f && f !== this.countTarget && !back.includes(f)) back.push(f);
    }
    this.countLeft = back;
  }

  /**
   * Another job is coming in (Project 'reset': an open, a draft restore,
   * close, New, a PDF import). What the count tool held is the LAST job's:
   * left armed, the first tap on the next job's sheet made the last job's
   * item there, with its name, floor, trade and price, and no form. So the
   * count is put down, and with it the Item box while it still shows that
   * count's name -- a different name typed since is his, and stays. The
   * floor, sub-category and cost type the last job's answers left go too:
   * a typed name, and every window and door pin, was filed under them with
   * no form. The next job starts blank, as the first job of a session does
   * (desktop PDFCacheViewer._drop_per_project_reads). Reads no store: inside
   * loadFrom the new job's items are not in yet.
   *
   * A form still up from the last job answers nothing now (_ask), and a
   * press on one of its shapes still held is over: its release would have
   * put the last job's picture back over this one.
   */
  _dropPerProject() {
    this._job += 1;
    this._dropPress();
    const shown = String(this.options.pendingName || '').trim();
    if (this.mode === 'count' && shown && shown === String(this.countNamed || '').trim()) {
      this._syncToolName('');
    }
    this.forgetArmedCount();
    this._lastFloor = '';
    this._lastSub = '';
    this._lastCostType = 'material';
  }

  /**
   * The answer to a form, or null -- cancelled -- when another job came in
   * while it was up (a .takeoff dropped on the window, the portal handing
   * one over: neither waits for a form). Answered anyway, the count form
   * armed the NEXT job with the last one's item and filed a dot there, on
   * whatever sheet that job showed, at the point tapped on the other; an
   * area's form filed the last job's outline the same way. Every form a
   * tool asks before it writes goes through here.
   */
  async _ask(question) {
    const job = this._job;
    const answer = await question;
    if (job === this._job) return answer;
    if (answer != null) {
      this.emit('status', { text: 'Another job was opened while that form was up, '
        + 'so nothing was filed from it' });
    }
    return null;
  }

  /**
   * End a press on a shape that is still held -- the release, or anything
   * that must not happen in the middle of one (a page turn, a second
   * finger, the Delete key). What it moved is kept as ITS OWN undo level,
   * so the edit that follows has its own and one Ctrl+Z never takes both.
   * A press that moved nothing changed nothing, and leaves no trace.
   */
  _settlePress() {
    const press = this.dragVertex || this._moveDrag;
    const pre = this._preDrag;
    const moved = this._dragMoved;
    this._dropPress();
    if (!press || !pre || !moved) return;
    this.project.pushUndo('Reshape', pre);
    // Deferred while the pointer was down, so the counts settle once.
    const found = this.project.findItem(press.id);
    if (found) recompute(found.item);
  }

  /** Forget a held press on a shape, and the picture taken when it began. */
  _dropPress() {
    this.dragVertex = null;
    this._moveDrag = null;
    this._preDrag = null;
    this._dragMoved = false;
  }

  /**
   * True while a tool is collecting points. The foot bar watches this: with
   * no keyboard there is no Enter, so Finish has to be a button.
   */
  get chainLive() { return this.current.length > 0; }

  /** Drop the last point of a chain in progress — the foot bar's ⌫. */
  undoPoint() {
    if (!this.current.length) return false;
    this.current.pop();
    this.snapToFirst = false;
    this.emit('changed');
    return true;
  }

  /**
   * Abandon whatever is in progress. Never touches saved work -- and a drag
   * cut short (a page turn with the button still down) keeps what it moved
   * as an undo level, as its release would have, instead of leaving an edit
   * that no Ctrl+Z can take back.
   */
  cancel() {
    this.markup.clear();
    this.current = [];
    this.constrainedPt = null;
    this.snapToFirst = false;
    this._settlePress();
    this.emit('changed');
  }

  /**
   * Say which version of the current sheet is on screen.
   *
   * The SELECTION is cleared on every real flip. Changing sheets clears it
   * already (main.js goToPage, as the desktop's set_page does -- it did not,
   * and Delete then took a shape off the sheet just left; deleteSelected
   * refuses one anyway), but raising another version of the SAME sheet does
   * not — and a
   * selection left over from the sheet's own drawing would then be a set of
   * items the user can no longer see, still answering to Delete.
   */
  setVersionView(revId, revPage) {
    const id = String(revId || '');
    const changed = id !== this.viewingVersion.revId
      || revPage !== this.viewingVersion.revPage;
    this.viewingVersion = { revId: id, revPage: revPage == null ? null : revPage };
    if (changed) {
      this.cancel();
      if (this.selected.size) {
        this.selected.clear();
        this.emit('selection-changed', { ids: [] });
      }
      this.hoverId = null;
      this.hoverVertex = null;
      this.emit('changed');
    }
  }

  /**
   * Forget what the pointer was over.
   *
   * 'callout-hover' is emitted only when the item under the pointer
   * CHANGES, and while the pointer is on the detail preview the canvas
   * sees no movement at all. Without this, closing that preview and
   * putting the pointer back on the SAME bubble emits nothing and opens
   * nothing — the hover state still named it.
   */
  clearHoverState() {
    if (this.hoverId == null && this.hoverVertex == null) return;
    this.hoverId = null;
    this.hoverVertex = null;
    this.emit('changed');
  }

  get ppf() {
    return this.project.pagePpf(this.getCurrentPage());
  }

  get scaleLabel() {
    return this.project.pageScaleLabel(this.getCurrentPage());
  }

  // ── the frame the renderer needs ────────────────────────────────────

  previewState() {
    if (this.mode === 'pan' || !this.current.length) {
      // Grid and tile show a ghost cell before the first click.
      if ((this.mode === 'grid' || this.mode === 'tile') && this.cursorPage) {
        return { mode: this.mode, points: [], cursor: this.cursorPage, ...this.options };
      }
      return null;
    }
    return {
      mode: this.mode,
      points: this.current,
      cursor: this.cursorPage,
      constrained: this.constrainedPt,
      snapToFirst: this.snapToFirst,
      spacingIn: this.options.spacingIn,
      tileWIn: this.options.tileWIn,
      tileHIn: this.options.tileHIn,
      groutIn: this.options.groutIn,
    };
  }

  // ── input ───────────────────────────────────────────────────────────

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', e => this._onPointerDown(e));
    c.addEventListener('pointermove', e => this._onPointerMove(e));
    c.addEventListener('pointerup', e => this._onPointerUp(e));
    // The browser cancels a drag whenever it decides the gesture was really
    // its own. Without this the pan, the vertex drag and the half-drawn
    // stroke all stay live and the next unrelated touch continues them.
    c.addEventListener('pointercancel', e => this._onPointerUp(e));
    c.addEventListener('pointerleave', () => {
      this.cursorPage = null;
      this.constrainedPt = null;
      this.emit('changed');
    });
    c.addEventListener('dblclick', e => this._onDoubleClick(e));
    c.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  _onPointerDown(ev) {
    this.canvas.setPointerCapture?.(ev.pointerId);

    if (ev.pointerType === 'touch') {
      this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this._pointers.size === 2) { this._enterPinch(); return; }
      if (this._pointers.size > 2) return;   // a palm; ignore it
    }

    const pt = this.viewport.eventToPage(ev);

    // Middle-drag pans from any tool, before every other branch.
    if (ev.button === 1) {
      ev.preventDefault();
      this._startPan(ev);
      return;
    }

    // Right-drag pans from any tool. The press only arms it; a click that
    // never moves falls through to the context menu on release.
    if (ev.button === 2) {
      this._rmbCandidate = { x: ev.clientX, y: ev.clientY };
      this._rmbPanned = false;
      return;
    }

    if (ev.button !== 0) return;

    const usePt = (ev.shiftKey && this.constrainedPt) ? this.constrainedPt : pt;

    // Read-only. Pan falls straight through, and so does a tool whose result
    // is going somewhere temporary — a dimension you take to read a drawing
    // is looking, not editing. Everything that would put something INTO the
    // project is held.
    if (this.readOnly && this.mode !== 'pan' && !this.isScratchTool(this.mode)) {
      this.emit('status', { text: this.readOnlyReason || READ_ONLY_DEFAULT });
      return;
    }

    if (ev.pointerType === 'touch' && this.mode === 'pan') {
      this._armLongPress(ev);
    }
    if (this.mode === 'pan') return this._panModePress(ev, pt);
    if (isMarkupTool(this.mode)) return this._markupPress(ev, pt, usePt);

    // A finger does not commit a point on contact. Every pinch starts with
    // one finger down, and committing here dropped a stray vertex into the
    // polygon being traced each time the estimator zoomed in to find a
    // corner — with no way to remove just that one. The point is earned on
    // the lift instead, once it is known no second finger arrived.
    if (ev.pointerType === 'touch') {
      this._pendingTap = { x: ev.clientX, y: ev.clientY };
      return;
    }
    this._collectPoint(ev, pt, usePt);
  }

  /** The point-collecting half of a press: a click, or a settled tap. */
  _collectPoint(ev, pt, usePt) {
    switch (this.mode) {
      case 'distance':
      case 'calibrate':
        this.current.push(usePt);
        if (this.current.length >= 2) {
          const pts = this.current.slice(0, 2);
          this.current = [];
          if (this.mode === 'distance') this._finalizeDistance(pts);
          else this._finishCalibration(pts);
        }
        break;

      case 'pitch':
        // No shift constraint here, deliberately.
        this.current.push(pt);
        if (this.current.length >= 2) {
          const pts = this.current.slice(0, 2);
          this.current = [];
          this._finalizePitch(pts);
        }
        break;

      case 'area':
      case 'slope_area':
      case 'grid':
      case 'tile':
        if (this.snapToFirst && this.current.length >= 3) {
          const pts = this.current.slice();
          this.current = [];
          this.snapToFirst = false;
          this._finalizePolygon(this.mode, pts);
        } else {
          this.current.push(usePt);
        }
        break;

      case 'polyline':
      case 'linear_count':
        this.current.push(usePt);
        break;

      case 'count':
        this._addCountPoint(pt);
        break;

      case 'window':
      case 'door':
        this._addOpeningPin(this.mode, pt);
        break;

      default:
        break;
    }
    this.emit('changed');
  }

  _panModePress(ev, pt) {
    const hit = this.hitTest(pt);
    if (hit && hit.item.type === 'page_ref') {
      this._calloutPress = { item: hit.item, x: ev.clientX, y: ev.clientY };
    }
    // Read-only: select it so it can be read, but arm NO drag. This is the
    // single place a move or a reshape begins, which is why the gate is here
    // rather than in the hit test — a viewer that cannot click a wall to see
    // what it is would not be a viewer.
    if (this.readOnly) {
      if (hit) this._select(hit.item, ev);
      else if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
        this.selected.clear();
        this.emit('selection-changed', { ids: [] });
      }
      this._startPan(ev);
      return;
    }
    if (hit && hit.vertexIndex >= 0) {
      this._select(hit.item, ev);
      this.dragVertex = { id: hit.item._uid, index: hit.vertexIndex };
      this._preDrag = this.project.snapshot();
      this._dragMoved = false;
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    if (hit) {
      const already = this.selected.has(hit.item._uid);
      this._select(hit.item, ev);
      if (already) {
        this._moveDrag = { id: hit.item._uid, last: pt };
        this._preDrag = this.project.snapshot();
        this._dragMoved = false;
        this.canvas.style.cursor = 'move';
        return;
      }
    } else if (!ev.ctrlKey && !ev.metaKey && !ev.shiftKey) {
      this.selected.clear();
      this.emit('selection-changed', { ids: [] });
    }
    this._startPan(ev);
  }

  // ── touch gestures ──────────────────────────────────────────────────

  /**
   * A second finger landed. Two fingers always mean look-at, never draw, so
   * whatever the first finger had started is stood down first.
   */
  _enterPinch() {
    const [a, b] = [...this._pointers.values()];
    if (!a || !b) return;
    this._clearLongPress();
    this._pendingTap = null;
    if (this._panning) {
      this._panning = false;
      this._panLast = null;
      this.canvas.style.cursor = CURSORS[this.mode] || 'default';
    }
    // A stroke cannot survive: you cannot draw and pinch with the same hand.
    // Say so rather than letting it vanish without a word.
    if (this.markup.drawing) {
      this.markup.clear();
      this.emit('status', { text: 'Stroke discarded — two fingers zoom.' });
    }
    // A drag the first finger had begun ends here, with an undo level for
    // whatever it had moved.
    this._settlePress();
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this._pinch = {
      startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      startZoom: this.viewport.zoom,
      lastMid: mid,
      rect: this.canvas.getBoundingClientRect(),
    };
    this.emit('changed');
  }

  /** Spread zooms about the point between the fingers; sliding both pans. */
  _updatePinch() {
    const [a, b] = [...this._pointers.values()];
    if (!a || !b || !this._pinch) return;
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = this._pinch.rect;
    this.viewport.panBy(mid.x - this._pinch.lastMid.x,
                        mid.y - this._pinch.lastMid.y);
    this.viewport.setZoomAt(mid.x - r.left, mid.y - r.top,
                            this._pinch.startZoom * dist / this._pinch.startDist);
    this._pinch.lastMid = mid;
    this.emit('changed');
    this.emit('zoom-changed', { zoom: this.viewport.zoom });
  }

  /**
   * A finger held still is the right mouse button. Only in pan mode: in a
   * chain tool the right button pops a vertex, and the press that armed it
   * would be the vertex popped — the foot bar's "Undo point" says what it
   * does instead.
   */
  _armLongPress(ev) {
    this._clearLongPress();
    this._lpFired = false;
    const at = { x: ev.clientX, y: ev.clientY,
                 clientX: ev.clientX, clientY: ev.clientY };
    this._lpStart = at;
    this._lpTimer = setTimeout(() => {
      this._lpTimer = null;
      if (this._pinch) return;
      this._lpFired = true;
      if (this._panning) {
        this._panning = false;
        this._panLast = null;
        this.canvas.style.cursor = CURSORS[this.mode] || 'default';
      }
      // A finger held still is not a drag. One never lands still: on a
      // corner or a selected shape, a tremble under the slop had already
      // reshaped or moved it -- with no undo level, so Delete then Undo
      // brought back the shape as the tremble left it, and closing the menu
      // kept the change. What it moved is taken back before the menu opens
      // (which finds the shape again, where it was).
      if (this._preDrag && this._dragMoved) {
        // (restore() says 'restored': the count tool finds its counts in
        // the store put back -- every item object is a new one now.)
        this.project.restore(this._preDrag);
        // Not an undo level (the store is the pre-press store again), but
        // still a change: a save composed while the tremble stood holds the
        // trembled shape, and only a moved change count tells it so.
        this.project.markDirty();
        this.project.emit('items-changed', {});
      }
      this._dropPress();
      this._onRightClick(at);
    }, LONG_PRESS_MS);
  }

  _clearLongPress() {
    if (this._lpTimer) { clearTimeout(this._lpTimer); this._lpTimer = null; }
    this._lpStart = null;
  }

  _startPan(ev) {
    this._panning = true;
    this._panLast = { x: ev.clientX, y: ev.clientY };
    this.canvas.style.cursor = 'grabbing';
  }

  _onPointerMove(ev) {
    if (ev.pointerType === 'touch') {
      if (this._pointers.has(ev.pointerId)) {
        this._pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      }
      if (this._pinch) { this._updatePinch(); return; }
      if (this._lpStart
          && Math.hypot(ev.clientX - this._lpStart.x,
                        ev.clientY - this._lpStart.y) > TAP_SLOP) {
        this._clearLongPress();
      }
    }

    const pt = this.viewport.eventToPage(ev);
    this.cursorPage = pt;

    if (this._panning && this._panLast) {
      const dxScreen = ev.clientX - this._panLast.x;
      const dyScreen = ev.clientY - this._panLast.y;
      this._panLast = { x: ev.clientX, y: ev.clientY };
      // While the overlay's Align is on, the same drag moves the overlay
      // rather than the view. In SHEET pixels, so the nudge survives zooming.
      if (this.overlayDrag) {
        this.overlayDrag(dxScreen / this.viewport.zoom, dyScreen / this.viewport.zoom);
        return;
      }
      this.viewport.panBy(dxScreen, dyScreen);
      this.emit('changed');
      return;
    }

    if (this._rmbCandidate) {
      const dx = ev.clientX - this._rmbCandidate.x;
      const dy = ev.clientY - this._rmbCandidate.y;
      if (Math.abs(dx) + Math.abs(dy) > RMB_PAN_THRESHOLD) {
        this._rmbPanned = true;
        this.viewport.panBy(dx, dy);
        this._rmbCandidate = { x: ev.clientX, y: ev.clientY };
        this.emit('changed');
      }
      return;
    }

    if (this.dragVertex) {
      const found = this.project.findItem(this.dragVertex.id);
      if (found) {
        const pts = found.item.points;
        if (this.dragVertex.index < pts.length) {
          pts[this.dragVertex.index] = pt;
          this._dragMoved = true;
          // A tile item re-lays its whole pattern on every recompute. On a
          // floor of small tile that is thousands of polygon tests per mouse
          // move, and the drag stops tracking the cursor. Geometry is enough
          // to draw with; the counts are settled once, on release.
          if (found.item.type === 'tile') found.item.value = null;
          else recompute(found.item);
          this.project.markDirty();
        }
      }
      this.emit('changed');
      return;
    }

    if (this._moveDrag) {
      const found = this.project.findItem(this._moveDrag.id);
      if (found) {
        const dx = pt[0] - this._moveDrag.last[0];
        const dy = pt[1] - this._moveDrag.last[1];
        translateItem(found.item, dx, dy);
        this._dragMoved = true;
        if (found.item.type !== 'tile') recompute(found.item);
        this.project.markDirty();
        this._moveDrag.last = pt;
      }
      this.emit('changed');
      return;
    }

    if (isMarkupTool(this.mode) && this._markupMove(ev, pt)) return;

    // 45° constraint, only while something is in progress.
    this.constrainedPt = null;
    if (ev.shiftKey && this.current.length && CONSTRAINED_TOOLS.has(this.mode)) {
      this.constrainedPt = constrainTo45(this.current[this.current.length - 1], pt);
    }

    // Snap back to the first vertex, so a click there closes the shape.
    this.snapToFirst = false;
    if (this.current.length >= 3 &&
        (CLOSING_TOOLS.has(this.mode) || this.mode === 'polyline')) {
      const [fx, fy] = this.viewport.toScreen(this.current[0][0], this.current[0][1]);
      const rect = this.canvas.getBoundingClientRect();
      const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
      const r = SNAP_FIRST_RADIUS * this.uiScale;
      this.snapToFirst = (sx - fx) ** 2 + (sy - fy) ** 2 < r * r;
      this.canvas.style.cursor = this.snapToFirst ? 'pointer' : 'crosshair';
    }

    if (this.mode === 'pan') {
      const hit = this.hitTest(pt);
      const nextHover = hit ? hit.item._uid : null;
      const nextVert = hit && hit.vertexIndex >= 0
        ? { id: hit.item._uid, index: hit.vertexIndex } : null;
      if (nextHover !== this.hoverId ||
          JSON.stringify(nextVert) !== JSON.stringify(this.hoverVertex)) {
        this.hoverId = nextHover;
        this.hoverVertex = nextVert;
        this.emit('changed');
        // Only a mouse hovers. A finger's pointermove is a drag in progress,
        // and firing this on touch would open a preview the user is trying
        // to pan past.
        if (ev.pointerType !== 'touch') {
          const over = hit && hit.item.type === 'page_ref' ? hit.item : null;
          this.emit('callout-hover', { item: over, x: ev.clientX, y: ev.clientY });
        }
      }
      this.canvas.style.cursor = hit
        ? (hit.vertexIndex >= 0 ? 'grab' : 'move')
        : 'grab';
      return;
    }

    this.emit('changed');
  }

  _onPointerUp(ev) {
    this.canvas.releasePointerCapture?.(ev.pointerId);

    const wasTouch = ev.pointerType === 'touch';
    if (wasTouch) {
      this._pointers.delete(ev.pointerId);
      if (this._pinch && this._pointers.size < 2) {
        this._pinch = null;
        // The finger still down must not carry on as a pan or a tap: the
        // gesture the estimator made was a zoom, and it is over.
        this._pendingTap = null;
        this._panning = false;
        this._panLast = null;
      }
    }
    this._clearLongPress();

    // A tap earns its point here, once no second finger has arrived.
    const tap = this._pendingTap;
    this._pendingTap = null;
    if (tap && !this._pinch && !this._lpFired && ev.type === 'pointerup'
        && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) <= TAP_SLOP) {
      const pt = this.viewport.eventToPage(ev);
      this._collectPoint(ev, pt, pt);   // no Shift constraint from a finger
    }

    // Decided here rather than on press, because the same gesture also
    // moves the pin. Captured before the drag teardown below clears the flag.
    const bubble = this._calloutPress;
    this._calloutPress = null;
    if (bubble && !this._dragMoved && !this._lpFired
        && ev.type === 'pointerup'
        && Math.hypot(ev.clientX - bubble.x, ev.clientY - bubble.y) <= CLICK_SLOP) {
      this.emit('callout-activated', {
        item: bubble.item, x: ev.clientX, y: ev.clientY,
        pointerType: ev.pointerType || 'mouse',
      });
    }

    if (this._lpFired) {
      // The long press already did the work; the lift must not select,
      // finish a stroke, or pan.
      this._lpFired = false;
      this._panning = false;
      this._panLast = null;
      this.dragVertex = null;
      this._moveDrag = null;
      this._preDrag = null;
      this._dragMoved = false;
      this.emit('changed');
      return;
    }

    if (this._panning) {
      this._panning = false;
      this._panLast = null;
      this.canvas.style.cursor = CURSORS[this.mode] || 'default';
    }

    if (this.dragVertex || this._moveDrag) {
      // Only a drag that actually moved something is an edit. A plain click
      // to select used to push an identical snapshot and wipe the redo stack.
      // One that moved nothing is left as it is: it used to put the press's
      // picture back "to leave no trace", and a Delete pressed while the
      // button was held was undone by that, with its undo level left behind
      // doing nothing.
      this._settlePress();
      this.canvas.style.cursor = CURSORS[this.mode] || 'default';
      this.project.emit('items-changed', {});
      this.emit('changed');
    }

    if (isMarkupTool(this.mode) && ev.button === 0 && ev.type === 'pointerup') {
      this._markupRelease(ev);
    } else if (isMarkupTool(this.mode) && ev.type === 'pointercancel') {
      this.markup.clear();     // the browser took the gesture; leave no ghost
      this.emit('changed');
    }

    if (ev.button === 2 && this._rmbCandidate) {
      const panned = this._rmbPanned;
      this._rmbCandidate = null;
      this._rmbPanned = false;
      if (!panned) this._onRightClick(ev);
    }
  }

  _onDoubleClick(ev) {
    const pt = this.viewport.eventToPage(ev);
    if (this.mode === 'pan') {
      // The browser delivers a double-click as its OWN event, so the press
      // refusal above does not cover it. Properties is an edit dialog.
      if (this.readOnly) {
        this.emit('status', { text: this.readOnlyReason || READ_ONLY_DEFAULT });
        return;
      }
      const hit = this.hitTest(pt);
      if (hit) this.host.openProperties?.(hit.item);
      return;
    }
    // A double-click finishes a chain. The second click of the pair already
    // pushed a duplicate point, so drop it.
    if (CHAIN_TOOLS.has(this.mode) && this.current.length >= 1) {
      const pts = this.current.slice(0, -1);
      this.current = [];
      this.snapToFirst = false;
      this._finishChain(pts);
    }
  }

  /** `ev` may be a real event or a plain {clientX, clientY} from a long press. */
  _onRightClick(ev) {
    const pt = this.viewport.eventToPage(ev);
    if (CHAIN_TOOLS.has(this.mode)) {
      this.current.pop();
      this.snapToFirst = false;
      this.emit('changed');
      return;
    }
    // Distance and calibrate cancel on a right-click. Pitch deliberately does
    // not — the desktop's branch omits it, and a stray right-click mid-read
    // should not throw away the first point.
    if (this.mode === 'distance' || this.mode === 'calibrate') {
      this.current = [];
      this.emit('changed');
      return;
    }
    if (this.mode === 'pan') {
      const hit = this.hitTest(pt);
      // The item menu is Delete / Hide / Properties — all edits. Selecting
      // is still allowed, so a right-click still says what you clicked.
      if (this.readOnly) {
        if (hit) this._select(hit.item, { ctrlKey: false, shiftKey: false });
        this.emit('status', { text: this.readOnlyReason || READ_ONLY_DEFAULT });
        return;
      }
      if (hit) {
        this._select(hit.item, { ctrlKey: false, shiftKey: false });
        this.host.showItemMenu?.(hit.item, ev);
      } else if (this.selected.size) {
        const first = this.project.findItem([...this.selected][0]);
        if (first) this.host.showItemMenu?.(first.item, ev);
      } else {
        this.selected.clear();
        this.emit('selection-changed', { ids: [] });
      }
    }
  }

  _onWheel(ev) {
    ev.preventDefault();
    const step = 1 + (Number(this.zoomStepPercent) || 15) / 100;
    const rect = this.canvas.getBoundingClientRect();
    const sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;

    if (this.wheelMode === 'scroll' && !ev.ctrlKey) {
      // Touchpad style: the wheel scrolls, Ctrl still zooms.
      // deltaMode is 0 in pixels, 1 in LINES (Firefox's default for a real
      // wheel) and 2 in pages. Without scaling those, a Firefox wheel moves
      // the drawing about three pixels a click.
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? this.viewport.height : 1;
      let dx = ev.deltaX * unit, dy = ev.deltaY * unit;
      if (ev.shiftKey && dx === 0) { dx = dy; dy = 0; }
      this.viewport.panBy(-dx, -dy);
    } else {
      this.viewport.zoomAt(sx, sy, ev.deltaY < 0 ? step : 1 / step);
    }
    this.emit('changed');
    this.emit('zoom-changed', { zoom: this.viewport.zoom });
  }

  /** Enter / Escape / Delete and the rest of the canvas keyboard map. */
  handleKey(ev) {
    const k = ev.key;
    if (k === 'Escape') {
      if (this.current.length) { this.cancel(); return true; }
      if (this.selected.size) {
        this.selected.clear();
        this.emit('selection-changed', { ids: [] });
        this.emit('changed');
        return true;
      }
      return false;
    }
    if (k === 'Enter') {
      if (TWO_CLICK_TOOLS.has(this.mode) && this.current.length >= 2) {
        const pts = this.current.slice(0, 2);
        this.current = [];
        if (this.mode === 'distance') this._finalizeDistance(pts);
        else if (this.mode === 'pitch') this._finalizePitch(pts);
        else this._finishCalibration(pts);
        return true;
      }
      if (CHAIN_TOOLS.has(this.mode) && this.current.length >= 2) {
        const pts = this.current.slice();
        this.current = [];
        this._finishChain(pts);
        return true;
      }
      return false;
    }
    // Delete and the nudge arrows never touch a hit test, so the gate there
    // does not cover them. The selection is cleared on every flip, so this
    // should be unreachable — but "should be" is what the desktop's Pan bug
    // was, and the cost of being wrong here is deleting work that is not on
    // screen to see go.
    if (this.readOnly && this.selected.size) {
      const nudging = k.startsWith('Arrow') && (ev.shiftKey || !this.arrowsNavigatePages);
      if (k === 'Delete' || k === 'Backspace' || nudging) {
        this.emit('status', { text: this.readOnlyReason || READ_ONLY_DEFAULT });
        return true;
      }
    }
    if ((k === 'Delete' || k === 'Backspace') && this.selected.size) {
      this.deleteSelected();
      return true;
    }
    // Nudge only when the arrow keys are not the user's page-turn keys, or
    // they would lose a way to move through the set as soon as anything is
    // selected. Shift always nudges, which is the escape hatch either way.
    if (k.startsWith('Arrow') && this.selected.size
        && (ev.shiftKey || !this.arrowsNavigatePages)) {
      const nudge = ev.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-nudge, 0], ArrowRight: [nudge, 0],
                  ArrowUp: [0, -nudge], ArrowDown: [0, nudge] }[k];
      if (d) {
        // A drag still held is its own edit, and ends first. Only what is
        // on the drawing on screen moves (_selectionHere).
        this._settlePress();
        const { here } = this._selectionHere();
        if (!here.length) return true;
        this.project.transact('Nudge', () => {
          for (const id of here) {
            const f = this.project.findItem(id);
            if (f) {
              translateItem(f.item, d[0], d[1]);
              recompute(f.item);
            }
          }
        });
        this.emit('changed');
        return true;
      }
    }
    return false;
  }

  /**
   * Delete the selected SHAPES, not their whole items -- the Delete key and
   * Edit > Delete Selected (desktop delete_selected_measurement): a run
   * going re-adds its item, a main shape going hands it to the next run.
   * The whole item is the Items list's Delete, which asks first. One undo
   * level. A drag still held ends first, as its own level.
   *
   * Only what is on the drawing on screen. A selection left over from
   * another sheet used to go too: a run on the sheet just turned away from
   * was deleted with nothing on screen moving, and only the Items list's
   * total said so. The desktop's page turn clears the selection, and so does
   * this app's now; this is the backstop, and it says what it left.
   * Returns how many shapes went.
   */
  deleteSelected() {
    if (!this.selected.size) return 0;
    this._settlePress();
    const { here, elsewhere } = this._selectionHere();
    const n = here.length ? this.project.dropShapes(here) : 0;
    this.selected.clear();
    this.emit('selection-changed', { ids: [] });
    if (elsewhere) {
      this.emit('status', { text: elsewhere === 1
        ? 'Left 1 selected shape as it was — it is not on the drawing on screen'
        : `Left ${elsewhere} selected shapes as they were — they are not on the drawing on screen` });
    }
    this.emit('changed');
    return n;
  }

  /**
   * The selected ids that are on the drawing on screen: on this sheet and
   * painted over the version up (_onScreen), or on no sheet at all (an item
   * kept only in the list). `elsewhere` counts the rest.
   */
  _selectionHere() {
    const page = this.getCurrentPage();
    const here = [];
    let elsewhere = 0;
    for (const id of this.selected) {
      const f = this.project.findItem(id);
      if (!f) continue;
      if (f.pageKey < 0 || (f.pageKey === page && this._onScreen(f.item))) here.push(id);
      else elsewhere += 1;
    }
    return { here, elsewhere };
  }

  // ── markup ──────────────────────────────────────────────────────────
  //
  // Markup is drag-based, not click-based: press, move, release. That is the
  // one interaction shape the takeoff tools do not use, which is why it lives
  // in its own three handlers rather than in the switch above.

  _markupPress(ev, pt, usePt) {
    const st = this.markup;
    const style = this.markupStyle;

    switch (this.mode) {
      case 'draw':
        st.stroke = beginStroke(pt, style.penColor, style.penWidth);
        st.drawing = true;
        break;

      case 'highlight':
        st.stroke = beginStroke(pt, style.highlightColor, style.highlightWidth);
        st.drawing = true;
        break;

      case 'highlight_rect':
        st.rectStart = pt;
        st.rectCur = pt;
        st.drawing = true;
        break;

      case 'erase':
        st.eraserPos = pt;
        st.drawing = true;
        // One snapshot for the whole erase drag, taken before the first
        // deletion — otherwise a sweep across six strokes is six undo steps.
        this._eraseSnapshot = this.project.snapshot();
        this._erasedAny = false;
        this._eraseAt(pt);
        break;

      case 'textnote':
        // First press sets what the note points AT; the drag chooses where the
        // note itself sits, so a note can be parked clear of the linework.
        st.noteTip = pt;
        st.noteCur = pt;
        st.drawing = true;
        break;

      case 'page_ref':
        this._placeCallout(pt);
        break;

      default:
        break;
    }
    this.emit('changed');
  }

  /** Returns true when the move was consumed by a markup drag. */
  _markupMove(ev, pt) {
    const st = this.markup;
    if (!st.drawing) return false;

    switch (this.mode) {
      case 'draw':
      case 'highlight': {
        if (!st.stroke) return false;
        // Shift keeps a highlight straight: the run is anchored at the first
        // point, which is what makes a clean sweep along a wall possible.
        const target = ev.shiftKey && st.stroke.points.length
          ? constrainTo45(st.stroke.points[0], pt) : pt;
        if (ev.shiftKey) st.stroke.points.length = 1;
        extendStroke(st.stroke, target);
        break;
      }
      case 'highlight_rect':
        st.rectCur = pt;
        break;
      case 'erase':
        st.eraserPos = pt;
        this._eraseAt(pt);
        break;
      case 'textnote':
        st.noteCur = pt;
        break;
      default:
        return false;
    }
    this.emit('changed');
    return true;
  }

  _markupRelease(ev) {
    const st = this.markup;
    if (!st.drawing) return;
    st.drawing = false;

    switch (this.mode) {
      case 'draw':
      case 'highlight': {
        const stroke = st.stroke;
        st.stroke = null;
        if (stroke && stroke.points.length >= 2) {
          this.project.addAnnotation(this.getCurrentPage(), stroke,
            { label: this.mode === 'draw' ? 'Draw' : 'Highlight' });
        }
        break;
      }
      case 'highlight_rect': {
        const a = st.rectStart, b = st.rectCur;
        st.rectStart = null; st.rectCur = null;
        if (a && b && rectIsWorthKeeping(a, b)) {
          this.project.addAnnotation(this.getCurrentPage(), {
            points: [a.slice(), b.slice()],
            color: this.markupStyle.highlightColor.slice(),
            width: this.markupStyle.highlightWidth,
            visible: true,
            subtype: 'rect',
          }, { label: 'Box highlight' });
        }
        break;
      }
      case 'erase': {
        st.eraserPos = null;
        // Only an erase that removed something is an undo step.
        if (this._erasedAny && this._eraseSnapshot) {
          this.project.pushUndo('Erase', this._eraseSnapshot);
        }
        this._eraseSnapshot = null;
        this._erasedAny = false;
        break;
      }
      case 'textnote': {
        const tip = st.noteTip;
        const at = st.noteCur || tip;
        st.noteTip = null; st.noteCur = null;
        if (tip) this._placeNote(tip, at);
        break;
      }
      default:
        break;
    }
    this.emit('changed');
  }

  _eraseAt(pt) {
    const page = this.getCurrentPage();
    const list = this.project.annotations[page] || [];
    if (!list.length) return;
    const radiusPage = ERASER_RADIUS_PX / Math.max(this.viewport.zoom, 0.001);
    const hits = annotationsUnderEraser(list, pt, radiusPage);
    if (!hits.length) return;
    const gone = new Set(hits);
    this.project.annotations[page] = list.filter(a => !gone.has(a));
    this._erasedAny = true;
    this.project.markDirty();
    this.project.emit('annotations-changed', { pageKey: page });
  }

  async _placeNote(tip, at) {
    const spec = await this._ask(this.host.askNote?.({
      fontSize: this.markupStyle.noteFontSize,
    }));
    if (!spec || !String(spec.text || '').trim()) { this.emit('changed'); return; }
    const made = this._file(this.getCurrentPage(), makeTextNote({
      tip, notePos: at, text: spec.text, color: spec.color,
      fontSize: spec.fontSize, category: spec.category,
    }), { label: 'Note' });
    // A note carries no quantity and no scale, so the stamps every takeoff
    // item gets would be meaningless on it.
    if (made) {
      delete made.sort_order;
      delete made.scale;
      delete made.scale_label;
    }
    this.emit('changed');
  }

  async _placeCallout(at) {
    const spec = await this._ask(this.host.askCallout?.({}));
    if (!spec) { this.emit('changed'); return; }
    const made = this._file(this.getCurrentPage(), makeCallout({
      at, detail: spec.detail, sheet: spec.sheet, refPage: spec.refPage,
    }), { label: 'Callout' });
    if (made) { delete made.scale; delete made.scale_label; }
    this.emit('changed');
  }

  /** What the renderer needs to draw the markup in progress. */
  markupPreview() {
    const st = this.markup;
    if (!st.active) return null;
    return {
      mode: this.mode,
      stroke: st.stroke,
      rect: st.rectStart && st.rectCur ? { a: st.rectStart, b: st.rectCur } : null,
      rectColor: this.markupStyle.highlightColor,
      eraser: st.eraserPos,
      eraserRadius: ERASER_RADIUS_PX,
      noteTip: st.noteTip,
      noteCur: st.noteCur,
    };
  }

  _finishChain(pts) {
    const min = this.mode === 'polyline' || this.mode === 'linear_count' ? 2 : 3;
    if (pts.length < min) { this.emit('changed'); return; }
    if (this.mode === 'polyline') this._finalizePolyline(pts);
    else if (this.mode === 'linear_count') this._finalizeArray(pts);
    else this._finalizePolygon(this.mode, pts);
  }

  // ── hit testing ─────────────────────────────────────────────────────

  /**
   * What is under a page-space point.
   * Vertices win over bodies, and among vertices the NEAREST wins rather than
   * the topmost — grabbing a vertex you can see is what a user expects.
   */
  hitTest(pt) {
    const s = this.uiScale;
    const z = this.viewport.zoom;
    const vrad = (VERTEX_GRAB * s) / z;
    const erad = (EDGE_GRAB * s) / z;
    const crad = Math.max(7.0, PIN_GRAB * s * this.markerScale) / z;

    const page = this.getCurrentPage();
    // Nothing on a drawing this work was not traced on can be grabbed — the
    // filter below is what stops a drag from moving a measurement onto lines
    // it was never taken from. It deliberately matches what the renderer
    // paints, so nothing invisible is ever reachable.
    const items = (this.project.measurements[page] || [])
      .filter(m => this.project.isVisible(m) && this._onScreen(m));

    let best = null;
    let bestDist = Infinity;
    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      const r = ['count', 'window', 'door'].includes(m.type) ? crad : vrad;
      const pts = m.points || [];
      for (let v = 0; v < pts.length; v++) {
        const d = pxDist(pt, pts[v]);
        if (d <= r && d < bestDist) {
          bestDist = d;
          best = { item: m, vertexIndex: v };
        }
      }
    }
    if (best) return best;

    for (let i = items.length - 1; i >= 0; i--) {
      const m = items[i];
      const pts = m.points || [];
      if (isAreaType(m.type) && pts.length >= 3) {
        if (pointInPolygon(pt[0], pt[1], pts)) return { item: m, vertexIndex: -1 };
        if (nearAnySegment(pt, pts, erad, true)) return { item: m, vertexIndex: -1 };
      } else if (['distance', 'polyline', 'linear_count', 'pitch',
        // Painted as a line, so grabbable as a line. Its VERTICES were
        // already reachable from the loop above while nothing was painted at
        // all — an invisible item that could be dragged.
        'ref_distance'].includes(m.type)
                 && pts.length >= 2) {
        if (nearAnySegment(pt, pts, erad, false)) return { item: m, vertexIndex: -1 };
      } else if (m.type === 'page_ref' && pts.length >= 1) {
        // The bubble is a screen-space disc; the grab radius follows it.
        const r = (this.calloutRadiusPx || 14) / z;
        if (pxDist(pt, pts[0]) <= r) return { item: m, vertexIndex: 0 };
      } else if (m.type === 'textnote' && pts.length >= 2) {
        const fs = Number(m.font_size) || 12;
        const lines = String(m.text || '').split('\n');
        const chars = Math.max(...lines.map(l => l.length), 1);
        const w = Math.min(chars * fs * 0.55 + 16, 296) / z;
        const h = (lines.length * fs * 1.5 + 16) / z;
        const c = pts[1];
        if (Math.abs(pt[0] - c[0]) <= w / 2 && Math.abs(pt[1] - c[1]) <= h / 2) {
          return { item: m, vertexIndex: -1 };
        }
      }
    }
    return null;
  }

  _select(item, ev) {
    const additive = ev && (ev.ctrlKey || ev.metaKey);
    if (additive) {
      if (this.selected.has(item._uid)) this.selected.delete(item._uid);
      else this.selected.add(item._uid);
    } else if (!this.selected.has(item._uid) || this.selected.size > 1) {
      this.selected = new Set([item._uid]);
    }
    this.emit('selection-changed', { ids: [...this.selected] });
    this.emit('changed');
  }

  select(ids) {
    this.selected = new Set(Array.isArray(ids) ? ids : [ids]);
    this.emit('selection-changed', { ids: [...this.selected] });
    this.emit('changed');
  }

  // ── writing items ───────────────────────────────────────────────────

  _base(type, extra = {}) {
    const ppf = this.ppf;
    return {
      type,
      notes: '',
      floor_level: this._lastFloor || '',
      category: '',
      sub_category: this._lastSub || '',
      cost_type: this._lastCostType || 'material',
      unit_cost: 0.0,
      visible: true,
      ppf,
      scale: this.scaleLabel,
      scale_label: this.scaleLabel,
      ...extra,
    };
  }

  _finalizeDistance(pts) {
    const ppf = this.ppf;
    const ft = pxDist(pts[0], pts[1]) / ppf;
    const m = this._base('distance', {
      points: pts.map(p => p.slice()),
      label: formatDistanceLabel(ft, '1/2'),
      name: this.options.pendingName || '',
      color: nextPaletteColor(),
      value: ft,
      precision: '1/2',
      floor_level: '', category: '', sub_category: '',
      cost_type: 'material',
    });
    // A ruler is not part of the estimate: no dialog, and no sort_order.
    const created = this._commit(m, 'Measure');
    if (created) delete created.sort_order;
    this.emit('status', {
      text: this.scratchSink
        ? `${formatFt(ft)} — a temporary dimension; it is not saved with the project`
        : `Measured ${formatFt(ft)}`,
    });
  }

  _finalizePitch(pts) {
    const dx = Math.abs(pts[1][0] - pts[0][0]);
    const dy = Math.abs(pts[1][1] - pts[0][1]);
    const rise12 = dx < 1e-9 ? Infinity : (12.0 * dy) / dx;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const m = this._base('pitch', {
      points: pts.map(p => p.slice()),
      name: this.options.pendingName || '',
      color: nextPaletteColor(),
      value: Number.isFinite(rise12) ? rise12 : 0,
      pitch: Number.isFinite(rise12) ? rise12 : 0,
      angle_deg: angle,
      label: pitchLabel(rise12),
      floor_level: '', category: '', sub_category: '',
      cost_type: 'material',
    });
    // Pitch is a ratio of pixels — it carries no scale at all.
    delete m.scale;
    delete m.scale_label;
    const created = this._commit(m, 'Pitch');
    if (created) delete created.sort_order;
    this.emit('status', {
      text: `Pitch ${pitchLabel(rise12)} (${angle.toFixed(0)}°)`
        + (this.scratchSink ? ' — temporary; not saved with the project' : ''),
    });
  }

  async _finalizePolygon(mode, pts) {
    const ppf = this.ppf;
    if (!ppf || pts.length < 3) { this.emit('changed'); return; }
    const areaFt2 = polygonArea(pts) / (ppf * ppf);
    const perimFt = perimeter(pts) / ppf;

    if (mode === 'area' && this.scratchSink) {
      // A temporary area has nothing to name, nothing to file under a trade
      // and no cost — so no dialog. Reading a room off a plan should cost two
      // clicks and a double-click, not a form.
      this._commit(this._base('area', {
        points: pts.map(p => p.slice()),
        label: `${areaFt2.toFixed(1)} sq ft`,
        value: areaFt2, perimeter: perimFt,
        name: '', color: nextPaletteColor(),
        floor_level: '', category: '', sub_category: '',
      }), 'Area');
      this.emit('status', {
        text: `${areaFt2.toFixed(1)} sq ft, ${formatFt(perimFt)} around `
          + '— a temporary dimension; it is not saved with the project',
      });
      return;
    }

    if (mode === 'area') {
      const spec = await this._ask(this.host.askItem?.({
        type: 'area',
        suggestedName: this.options.pendingName || `Area ${areaFt2.toFixed(0)} sq ft`,
        color: peekPaletteColor(),
      }));
      if (!spec) { this.emit('changed'); return; }
      nextPaletteColor();
      this._remember(spec);
      this._commit(this._base('area', {
        points: pts.map(p => p.slice()),
        label: spec.name || `${areaFt2.toFixed(1)} sq ft`,
        value: areaFt2, perimeter: perimFt,
        ...spec,
      }), 'Area');
      return;
    }

    if (mode === 'slope_area') {
      const spec = await this._ask(this.host.askSlopeRoof?.({
        flatArea: areaFt2,
        suggestedName: this.options.pendingName || '',
        color: peekPaletteColor(),
      }));
      if (!spec) { this.emit('changed'); return; }
      nextPaletteColor();
      this._remember(spec);
      const pitch = Number(spec.pitch) || 0;
      const factor = Math.sqrt(1 + (pitch / 12) ** 2);
      const sloped = areaFt2 * factor;
      this._commit(this._base('slope_area', {
        points: pts.map(p => p.slice()),
        label: spec.name || `${sloped.toFixed(1)} sq ft (${trimNum(pitch)}:12)`,
        value: sloped, flat_area: areaFt2, perimeter: perimFt, pitch,
        ...spec,
      }), 'Slope roof');
      return;
    }

    if (mode === 'grid') return this._finalizeGrid(pts, areaFt2, perimFt);
    if (mode === 'tile') return this._finalizeTile(pts, areaFt2, perimFt);
  }

  async _finalizeGrid(pts, areaFt2, perimFt) {
    const ppf = this.ppf;
    const angle = Number(this.options.gridAngle) || 0;
    const a = (angle * Math.PI) / 180;
    const ca = Math.cos(a), sa = Math.sin(a);
    const us = pts.map(([x, y]) => x * ca + y * sa);
    const vs = pts.map(([x, y]) => -x * sa + y * ca);
    const wPx = Math.max(...us) - Math.min(...us);
    const hPx = Math.max(...vs) - Math.min(...vs);
    // Too small to be a grid — a stray double-click, not an intent.
    if (wPx < 5 || hPx < 5) { this.emit('changed'); return; }

    const cwFt = Number(this.options.gridCellW) || 2;
    const chFt = Number(this.options.gridCellH) || 2;
    const cols = Math.max(1, Math.ceil(wPx / (cwFt * ppf)));
    const rows = Math.max(1, Math.ceil(hPx / (chFt * ppf)));

    const spec = await this._ask(this.host.askItem?.({
      type: 'grid',
      suggestedName: this.options.pendingName
        || `Grid ${cols}×${rows}  (${trimNum(cwFt, 2)}×${trimNum(chFt, 2)} ft)`,
      color: peekPaletteColor(),
      gridCells: [cwFt, chFt],
    }));
    if (!spec) { this.emit('changed'); return; }
    nextPaletteColor();
    this._remember(spec);
    const cw = Number(spec.cellW ?? cwFt), ch = Number(spec.cellH ?? chFt);
    const c2 = Math.max(1, Math.ceil(wPx / (cw * ppf)));
    const r2 = Math.max(1, Math.ceil(hPx / (ch * ppf)));

    this._commit(this._base('grid', {
      points: pts.map(p => p.slice()),
      grid_origin: pts[0].slice(),
      angle,
      cell_w_px: cw * ppf, cell_h_px: ch * ppf,
      cell_w_ft: cw, cell_h_ft: ch,
      cols: c2, rows: r2,
      label: spec.name || `Grid ${c2}×${r2}`,
      value: areaFt2, perimeter: perimFt,
      ...spec,
    }), 'Grid');
  }

  async _finalizeTile(pts, areaFt2, perimFt) {
    const bb = boundingBox(pts);
    if (bb.w < 5 || bb.h < 5) { this.emit('changed'); return; }
    const o = this.options;
    const spec = await this._ask(this.host.askTile?.({
      tileWIn: o.tileWIn, tileHIn: o.tileHIn, groutIn: o.groutIn,
      pattern: o.tilePattern, wastePct: tilePatternWaste(o.tilePattern),
      tilesPerBox: 0,
      areaFt2,
      suggestedName: this.options.pendingName,
      color: peekPaletteColor(),
    }));
    if (!spec) { this.emit('changed'); return; }
    nextPaletteColor();
    this._remember(spec);
    const item = this._base('tile', {
      points: pts.map(p => p.slice()),
      grid_origin: pts[0].slice(),
      angle: Number(o.tileAngle) || 0,
      pattern: spec.pattern ?? o.tilePattern,
      tile_w_in: Number(spec.tileWIn ?? o.tileWIn),
      tile_h_in: Number(spec.tileHIn ?? o.tileHIn),
      grout_in: Number(spec.groutIn ?? o.groutIn),
      waste_pct: Number(spec.wastePct ?? tilePatternWaste(o.tilePattern)),
      tiles_per_box: Number(spec.tilesPerBox) || 0,
      value: areaFt2, perimeter: perimFt,
      ...spec,
    });
    recompute(item);
    item.label = spec.name ||
      `Tile ${(item.tile_count || 0).toLocaleString('en-US')} (${patternLabel(item.pattern)})`;
    this._commit(item, 'Tile');
  }

  async _finalizePolyline(pts) {
    const ppf = this.ppf;
    const ft = pathLength(pts) / ppf;
    const spec = await this._ask(this.host.askItem?.({
      type: 'polyline',
      suggestedName: this.options.pendingName || `Run ${ft.toFixed(1)} ft`,
      color: peekPaletteColor(),
    }));
    if (!spec) { this.emit('changed'); return; }
    nextPaletteColor();
    this._remember(spec);
    this._commit(this._base('polyline', {
      points: pts.map(p => p.slice()),
      label: spec.name || formatFt(ft),
      value: ft,
      ...spec,
    }), 'Polyline');
  }

  async _finalizeArray(pts) {
    const ppf = this.ppf;
    const spacingIn = Number(this.options.spacingIn) || 12;
    const spacingPx = (spacingIn / 12) * ppf;
    const count = countAlong(pts, spacingPx);
    const spec = await this._ask(this.host.askItem?.({
      type: 'linear_count',
      suggestedName: this.options.pendingName || `${count} items @ ${trimNum(spacingIn)}"`,
      color: peekPaletteColor(),
      spacingIn,
    }));
    if (!spec) { this.emit('changed'); return; }
    nextPaletteColor();
    this._remember(spec);
    // The dialog can change the spacing, so the array is recounted before it
    // is written — never trust the number the suggestion was built from.
    const finalSpacing = Number(spec.spacingIn ?? spacingIn);
    const finalCount = countAlong(pts, (finalSpacing / 12) * ppf);
    this._commit(this._base('linear_count', {
      points: pts.map(p => p.slice()),
      spacing_in: finalSpacing,
      label: spec.name || `${finalCount} items`,
      value: finalCount,
      total_ft: pathLength(pts) / ppf,
      ...spec,
    }), 'Array');
  }

  /**
   * One count tap (desktop _add_count_point). In this order:
   *
   *   0. a name in the Item box that the tool did not put there for this
   *      count -- typed or picked since -- puts the armed count down: a new
   *      name starts the next item, as the Count hint says;
   *   0b. back on a drawing where a count is held (countLeft), the newest one
   *      held there takes the tap, while the box shows its name or is empty;
   *   1. the armed count, when it is on the drawing on screen;
   *   2. the armed answers: the first tap makes the item;
   *   3. by the name in the box: the first count of that name on this
   *      drawing, or a new one, with no form;
   *   4. nothing to go on: the form.
   *
   * Every item is matched BY IDENTITY among the ones on the drawing on
   * screen. A count traced on another drawing of this sheet is not under
   * the pencil: a dot added to it would be drawn nowhere.
   */
  _addCountPoint(pt) {
    const page = this.getCurrentPage();
    const list = this.project.itemsOn(page);
    const onScreen = list.filter(m => this._onScreen(m));
    const here = m => !!m && onScreen.includes(m);
    const typed = String(this.options.pendingName || '').trim();
    const cat = typed || String(this.options.countCategory || '').trim();
    const named = String(this.countNamed || '').trim();

    // 0. A new name in the box starts the next item (desktop 37248-37260).
    //    The count armed from the form used to keep the tap, and it went
    //    onto the item he had just named something else.
    if (typed && named && typed !== named && (this.countTarget || this.countSpec)) {
      this.countTarget = null;
      this.countSpec = null;
      this.countAnswers = null;
      this.countMustAsk = false;
    }

    // 0b. Back on a drawing where the tool held a count before its taps went
    //     on to another one: the NEWEST held here, unless the box names
    //     something else (desktop 37261-37287). The one counted here last
    //     taken back or deleted since is not on the drawing, and the one
    //     held before it takes the tap. The armed count is held where it is.
    if (!here(this.countTarget)) {
      const back = [...this.countLeft].reverse().find(m => here(m)
        && (!cat || String(m.name || '').trim() === cat));
      if (back) {
        const held = this.countLeft.filter(m => m !== back);
        if (this.countTarget && this._inStore(this.countTarget)) held.push(this.countTarget);
        this.countLeft = held;
        this.countTarget = back;
        this.countSpec = null;
        this.countAnswers = null;       // made again from the item itself
        this.countMustAsk = false;
        this.countNamed = String(back.name || '').trim();
      }
    }

    // 1. the armed count, on the drawing on screen, gains a point.
    if (here(this.countTarget)) {
      const t = this.countTarget;
      this.project.transact('Count', () => {
        t.points.push(pt.slice());
        t.value = t.points.length;
      });
      this._countGrew(page, t);
      this.emit('changed');
      return;
    }

    // 2. the armed answers -- from the form, or armed again by a step that
    //    took the count off -- make the item on the first tap only. Not
    //    under the name of a count the desktop framed on another drawing:
    //    the desktop hands that framing over on this path too (its spec
    //    branch ends in _inherit_count_framing), this app cannot, so the tap
    //    asks and says why, as the name in the box does (3). The answers
    //    stay armed: after a Cancel the next tap asks again, and on a
    //    drawing nothing is handed over to, it makes them.
    let why = '';
    if (this.countSpec) {
      why = this._framedNamesakeWords(countNameFrom(this.countSpec, cat), page);
      if (!why) {
        const made = this._file(page, this._countFrom(this.countSpec, pt, cat),
          { label: 'Count' });
        this.countTarget = made;
        this.countSpec = null;
        this.emit('changed');
        return;
      }
    }

    // 3. by the name in the box: the first count of that name on this
    //    drawing, or -- typed and nowhere here yet -- a new one, no form.
    //    Not for a Posts/Hardware count a step took off: made by its name
    //    it would come back with no lumber, and nothing would say so. Nor
    //    a NEW one under the name of a count the desktop framed -- on
    //    another drawing, or the armed one deleted since: the desktop hands
    //    that framing over (_inherit_count_framing), this app cannot, so
    //    the tap asks, and says why (the user's decision 2). Not reached
    //    when the armed answers asked (2): they are a NEW item, never a
    //    join onto a namesake here.
    if (!why && cat && !this.countMustAsk) {
      let existing = onScreen.find(m => m.type === 'count' && m.name === cat) || null;
      if (existing) {
        const it = existing;
        this.project.transact('Count', () => {
          it.points.push(pt.slice());
          it.value = it.points.length;
        });
        this._countGrew(page, it);
      } else if (typed) {
        why = this._framedNamesakeWords(cat, page);
        if (!why) {
          existing = this._file(page, this._base('count', {
            points: [pt.slice()],
            name: cat, label: cat,
            color: nextPaletteColor(),
            value: 1,
            count_number: nextCountNumber(this.project),
          }), { label: 'Count' });
        }
      }
      if (existing) {
        this._holdAndTake(existing, cat);
        this.emit('changed');
        return;
      }
    }

    // 4. nothing to go on -- ask. The answer makes (or joins) the item here
    //    and now, rather than arming the tool and coming back in: going back
    //    in through countSpec dropped the count held on the other drawing.
    //    Asked because of a desktop-framed count, the form says why, and so
    //    does the status line again: said at the step, it is long gone
    //    (six seconds) by the time he taps. A NEW count the answer makes
    //    under a name the desktop framed is made -- the form was the asking
    //    -- and the status line says it carries none of that framing: the
    //    form may have opened with no note (the box empty), and the desktop
    //    would have handed the framing over here too (37497-37500).
    if (!why && this.countMustAsk) {
      why = framedAskWords(this.countTarget && this.countTarget.name, 'taken', 'this tap');
    }
    if (why) this.emit('status', { text: why });
    this._ask(this.host.askCountItem?.({
      existing: onScreen.filter(m => m.type === 'count'),
      ...(why ? { note: why } : {}),
    }))
      .then(choice => {
        if (!choice) return;
        let existing = null;
        let bare = false;
        if (choice.continueItem) {
          const it = this._inStore(choice.continueItem) ? choice.continueItem
            : this._foundAgain(choice.continueItem);
          if (!it) {
            this.emit('status', { text: 'That count is no longer on the sheet — nothing was counted' });
            return;
          }
          this.project.transact('Count', () => {
            it.points.push(pt.slice());
            it.value = it.points.length;
          });
          this._countGrew(page, it);
          existing = it;
        } else if (choice.spec) {
          existing = this._file(page, this._countFrom(choice.spec, pt, cat), { label: 'Count' });
          // Asked while the tool still holds what it held at the tap: the
          // armed framed count deleted or taken off is one of the reasons.
          bare = !!existing && !!this._framedNamesakeWords(existing.name, page);
        }
        if (!existing) return;
        const name = String(existing.name || '').trim();
        if (name) this._syncToolName(name);
        this._holdAndTake(existing, name || cat);
        if (bare) this.emit('status', { text: framedBareWords(name) });
        this.emit('changed');
      });
  }

  /**
   * A new count made from answers (desktop _add_count_point's spec branch):
   * the form's, or the ones a step armed again. Never the desktop's
   * 'framing': its lumber and hardware lines are worked out by a framing
   * engine this app does not have, and a copied 'framing' without them
   * would be a Posts count that prices nothing and says it does.
   */
  _countFrom(spec, pt, cat) {
    const fields = {};
    for (const [k, v] of Object.entries(spec || {})) {
      if (k === 'framing' || k === 'catalog') continue;
      fields[k] = v && typeof v === 'object' ? structuredClone(v) : v;
    }
    const name = countNameFrom(fields, cat);
    return this._base('count', {
      points: [pt.slice()],
      value: 1,
      count_number: fields.count_number ?? nextCountNumber(this.project),
      ...fields,
      color: fields.color || nextPaletteColor(),
      name, label: name,
    });
  }

  /**
   * Would a NEW count called `name`, made on the drawing on screen of
   * `page`, be handed Posts/Hardware framing by the desktop? Then made here
   * with no form it would carry none of its lumber: the desktop hands the
   * framing over on every path that makes a count -- the armed answers, the
   * name in the box, the form at a click (_inherit_count_framing) -- and
   * this app has no framing engine to do it with. The words the tap asks
   * with, or '' for a name nothing is handed over to. Also the armed count
   * deleted since, its name still in the box (the user's decision 2: a
   * stricter rule than the desktop's, which would make it bare).
   */
  _framedNamesakeWords(name, page) {
    const n = String(name || '').trim();
    if (!n) return '';
    const t = this.countTarget;
    if (t && pyTruthy(t.framing) && String(t.name || '').trim() === n && !this._inStore(t)) {
      return framedAskWords(n, 'gone', 'this tap');
    }
    return this._framedSource(n, page) ? framedAskWords(n, 'there', 'this tap') : '';
  }

  /**
   * The count the desktop would hand its framing over from, to a new count
   * called `name` made on the drawing on screen of `page`, or null (desktop
   * _inherit_count_framing's candidates; diffed against its own lines in
   * tests/count-undo.mjs): a count of exactly that name, framed, on a
   * drawing the job is priced from -- takeoff on a drawing a sheet does not
   * count buys nothing, so it decides nothing -- and not on this drawing: a
   * namesake here is what Carry on with continues, not a source. Another
   * drawing of this sheet (its revision) is one. Whether one exists is all
   * the web asks; which the desktop would take is the desktop's.
   */
  _framedSource(name, page) {
    const here = String((this.viewingVersion || {}).revId || '');
    let model = null;
    for (const [pg, m] of this.project.allItems()) {
      if (!m || m.type !== 'count' || m.name !== name || !pyTruthy(m.framing)) continue;
      if (pg === page && itemRevId(m) === here) continue;
      model ||= new CountingModel({ metadata: this.project.metadata,
        measurements: this.project.measurements, pageCount: this.project.pageCount });
      if (model.itemCountsTowards(pg, m)) return m;
    }
    return null;
  }

  /**
   * The tap went onto `existing` by its name or by the form: the clicks
   * after it follow THIS item, and the count the tool held before is held
   * where it is, so going back there goes back to it (desktop
   * _add_count_point 37476-37493).
   */
  _holdAndTake(existing, cat) {
    const held = this.countTarget;
    if (held && held !== existing && this._inStore(held)) {
      const kept = this.countLeft.filter(m => this._inStore(m) && m !== held && m !== existing);
      kept.push(held);
      this.countLeft = kept;
    }
    this.countTarget = existing;
    this.countSpec = null;
    this.countAnswers = null;         // made again from the item itself
    this.countMustAsk = false;
    this.countNamed = String(cat || '').trim();
  }

  _addOpeningPin(kind, pt) {
    const pre = kind === 'window' ? 'win_' : 'door_';
    // Numbering is document-wide, not per sheet: a plan set numbers its
    // windows once across every drawing.
    let maxSeq = 0;
    for (const [, m] of this.project.allItems()) {
      if (m.type === kind) maxSeq = Math.max(maxSeq, Number(m[pre + 'seq']) || 0);
    }
    const seq = maxSeq + 1;
    const label = `${kind === 'window' ? 'Window' : 'Door'} ${seq}`;
    const color = kind === 'window'
      ? [0.20, 0.55, 1.00, 1.0]
      : [0.95, 0.45, 0.15, 1.0];

    this._file(this.getCurrentPage(), this._base(kind, {
      points: [pt.slice()],
      [pre + 'seq']: seq,
      [pre + 'number']: '',
      [pre + 'width']: '',
      [pre + 'height']: '',
      label, name: label,
      color,
      value: 1,
      category: CATEGORY_DEFAULT_OPENINGS,
    }), { label });
    this.emit('changed');
  }

  async _finishCalibration(pts) {
    const distPx = pxDist(pts[0], pts[1]);
    const text = await this._ask(this.host.askCalibration?.({ distPx }));
    if (text == null) { this.emit('changed'); return; }
    let ppf;
    try {
      ppf = ppfFromCalibration(distPx, Number(text));
    } catch (err) {
      this.host.alert?.('Invalid', err.message);
      this.emit('changed');
      return;
    }
    const page = this.getCurrentPage();
    // Calibration writes NO measurement. It only restates the sheet's scale,
    // and it leaves work already drawn at the scale it was drawn at.
    this.project.setPageScale(page, ppf);
    this.host.alert?.(
      'Scale Calibrated',
      `Scale set: ${ppf.toFixed(2)} pixels per foot\n(${distPx.toFixed(1)} px = ${Number(text)} ft)`
    );
    this.emit('changed');
  }

  /** True while this tool's result would go to the scratch store. */
  isScratchTool(mode) {
    return !!this.scratchSink && SCRATCH_CAPABLE.has(mode);
  }

  /**
   * File a finished item.
   *
   * With a scratch sink set it goes there and NEVER touches the project — not
   * marked temporary, not filtered out later, simply never put anywhere a
   * save can see. That is the whole guarantee, and it is structural rather
   * than a flag something has to remember to check.
   */
  _commit(item, label) {
    if (this.scratchSink) {
      this.scratchSink({ ...item, scratch: true });
      this.emit('changed');
      return null;
    }
    // Filed against the drawing it was traced on.
    //
    // `versionItems` keeps an item only where its rev_id matches the version
    // on screen, and no rev_id means the sheet's own drawing. So an item drawn
    // on a revision and left unstamped would disappear the instant it was
    // finished — filed under a drawing the estimator was not looking at. This
    // is the one place every finished item passes through, and it is the same
    // stamp, off the same state, that a temporary dimension already gets.
    const created = this._file(this.getCurrentPage(), item, { label });
    this.emit('changed');
    return created;
  }

  /** Is this item on the drawing on screen? The renderer's own test. */
  _onScreen(m) {
    return onThisVersion(m, this.viewingVersion.revId, this.viewingVersion.revPage,
      this.markOf);
  }

  /**
   * THE one place a finished item goes into the project — takeoff, a count,
   * a window or door, a note, a callout pin. Two things happen here and
   * nowhere else, so no tool can skip them:
   *
   * 1. It is STAMPED with the drawing it was traced on. An item drawn on a
   *    revision and left unstamped vanished the instant it was finished —
   *    filed under the sheet's own drawing, which was not on screen — and
   *    counted from a drawing nobody traced it on. The count, the opening
   *    pins, notes and callouts each called addItem directly and were never
   *    stamped; now nothing can be.
   *
   * 2. The FIRST takeoff on a sheet with none on any of its drawings books
   *    the drawing it was traced on as the one the sheet counts from
   *    (CountingModel.firstTakeoffBooking — the desktop's rule). Written in
   *    the SAME transaction as the item, so one Ctrl+Z takes back both, and
   *    the booking rides that undo level for Ctrl+Y.
   *
   * Then 'takeoff-filed' tells the app, which says the booking and asks —
   * once — when takeoff landed on a drawing that does not count.
   */
  _file(page, item, { label = 'Add item' } = {}) {
    const v = this.viewingVersion || {};
    const onSheet = page !== STANDALONE_PAGE && page >= 0;
    const stamped = (onSheet && v.revId)
      ? { ...item, rev_id: v.revId, rev_page: v.revPage }
      : item;
    let created = null;
    let booking = null;
    this.project.transact(label, () => {
      if (onSheet) {
        const model = new CountingModel({ metadata: this.project.metadata,
          measurements: this.project.measurements, pageCount: this.project.pageCount });
        booking = model.firstTakeoffBooking(page, stamped);
        if (booking) applyBooking(this.project.metadata, booking);
      }
      created = this.project.addItem(page, stamped, { label });
    });
    const level = this.project.undoTop;
    if (booking) {
      this.project.tagBooking(level, { kind: 'first', page, was: booking.was, now: booking.rid });
    }
    this.emit('takeoff-filed', { page, item: created, booking, level });
    return created;
  }

  /**
   * A point added to a count already on the sheet: said like a new item.
   * And the Items list told: transact() says only 'history-changed', so its
   * row read one mark short after every tap that joined a count -- "× 2"
   * beside a count of 3 -- until something else redrew it.
   */
  _countGrew(page, item) {
    this.project.emit('items-changed', { pageKey: page });
    // A Posts/Hardware count the desktop framed: its lumber and hardware
    // lines are the desktop engine's, worked out for the marks it last saw.
    // They are not this app's to touch (the user's decision 2), so the mark
    // goes on and the lines stay as they were -- said on every such tap,
    // never left to look right. The held count (rule 0b) can send a tap
    // here that he did not aim at it, so this is where it is said.
    if (pyTruthy(item && item.framing)) {
      this.emit('status', { text: framedJoinWords(item) });
    }
    this.emit('takeoff-filed', { page, item, booking: null, level: this.project.undoTop });
  }

  _remember(spec) {
    if (spec.floor_level !== undefined) this._lastFloor = spec.floor_level;
    if (spec.sub_category !== undefined) this._lastSub = spec.sub_category;
    if (spec.cost_type !== undefined) this._lastCostType = spec.cost_type;
  }

  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

/**
 * Move a whole item.
 *
 * The pattern anchor moves with it. A tile run whose boundary shifts while its
 * grid_origin stays put re-lays the whole floor: the same outline comes back
 * with a different tile count, and nothing on screen says why.
 */
function translateItem(item, dx, dy) {
  item.points = (item.points || []).map(([x, y]) => [x + dx, y + dy]);
  if (Array.isArray(item.grid_origin) && item.grid_origin.length >= 2) {
    item.grid_origin = [item.grid_origin[0] + dx, item.grid_origin[1] + dy];
  }
  if (Array.isArray(item.arrow) && item.arrow.length >= 2) {
    item.arrow = [item.arrow[0] + dx, item.arrow[1] + dy];
  }
}

function nearAnySegment(pt, pts, rad, closed) {
  const n = pts.length;
  const legs = closed ? n : n - 1;
  for (let i = 0; i < legs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (distToSegment(pt[0], pt[1], a[0], a[1], b[0], b[1]) <= rad) return true;
  }
  return false;
}

// One spacing rule, in geom.js. Counting here with a second implementation is
// how the drawn dots and the billed quantity come to disagree.
function countAlong(pts, spacingPx) {
  return pointsAlongPath(pts, spacingPx).length;
}

function nextCountNumber(project) {
  let max = 0;
  for (const [, m] of project.allItems()) {
    if (m.type === 'count') max = Math.max(max, Number(m.count_number) || 0);
  }
  return max + 1;
}

// ── a count made again (desktop GLPageWidget._rearm_count) ───────────────

/**
 * Desktop GLPageWidget._COUNT_TEMPLATE, verbatim (tests/count-undo-python-
 * truth.py lifts the desktop's own and compares): what a count carried on
 * with "Carry on with" is made again from, when a step takes its every mark
 * back -- it was not made from answers given this time.
 */
export const COUNT_TEMPLATE = Object.freeze(['name', 'notes', 'purpose', 'color',
  'floor_level', 'category', 'sub_category', 'cost_type', 'unit_cost',
  'catalog_code', 'catalog_unit', 'rate_unit']);

/** Desktop GLPageWidget.CLASS_FIELDS: where an item is filed. */
export const CLASS_FIELDS = Object.freeze(['floor_level', 'category', 'sub_category']);

/**
 * What the next tap makes a count again from, once a step took it off the
 * sheet: the answers it was armed with (`answers`, updated in place, as the
 * desktop's dict is), or -- carried on, not made from answers this time --
 * its own fields (COUNT_TEMPLATE). Filed where the item was filed last,
 * which is where a rename would have left it, and with its framing answers
 * when it had them (the desktop makes those again; this app refuses to:
 * ToolController._rearmCount). Pure; diffed against the desktop's own
 * _rearm_count in tests/count-undo.mjs.
 */
export function countAnswersAgain(target, answers) {
  const t = target || {};
  let a = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : null;
  if (!a) {
    a = {};
    for (const f of COUNT_TEMPLATE) if (f in t) a[f] = structuredClone(t[f]);
  }
  for (const f of CLASS_FIELDS) a[f] = (f in t) ? t[f] : ((f in a) ? a[f] : '');
  if (pyTruthy(t.framing)) a.framing = structuredClone(t.framing);
  else delete a.framing;
  return a;
}

/**
 * Why a count tap asks the form instead of making a Posts/Hardware count
 * the desktop framed (the user's decision 2). `how`: 'taken' -- a step took
 * it off the sheet; 'gone' -- the armed one was deleted; 'there' -- the name
 * is a framed count's elsewhere in the job. `when`: 'this tap' or 'the next
 * tap'.
 */
function framedAskWords(name, how, when) {
  const n = String(name || '').trim() || 'That count';
  const what = how === 'taken' ? `“${n}” was taken off the sheet. It carries`
    : how === 'gone' ? `“${n}” was deleted. It carried`
      : `“${n}” is counted elsewhere in this job with`;
  return `${what} Posts/Hardware framing made on the desktop, which this app cannot make `
    + `for a new count, so ${when} asks what you are counting.`;
}

/**
 * Said when the form's answer makes a count under a name the desktop
 * framed: it is made (the form was the asking), with none of that framing.
 */
function framedBareWords(name) {
  const n = String(name || '').trim() || 'This count';
  return `“${n}” was made without Posts/Hardware framing: the desktop framed a “${n}” in this `
    + 'job, and this app cannot make that framing for a new count, so this one prices no '
    + 'lumber or hardware.';
}

/**
 * The name a count made from answers gets (desktop _add_count_point's spec
 * branch): the answers', else the name in the box, else "Count".
 */
function countNameFrom(spec, cat) {
  return String((spec && spec.name) || '').trim() || cat || 'Count';
}

/** Said on a tap that adds a mark to a count the desktop framed. */
function framedJoinWords(item) {
  const n = String(item.name || '').trim() || 'This count';
  const marks = (item.points || []).length;
  return `“${n}” is at ${marks}. Its Posts/Hardware lumber and hardware were worked out on the `
    + 'desktop, and this app cannot work them out again: on the desktop, a mark added to it or '
    + 'taken off it brings them up to date.';
}

/** Python's truth for a JSON value: {} and [] and '' and 0 are false. */
function pyTruthy(v) {
  if (v == null || v === false || v === 0 || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** Did this store (pageKey -> item[]) hold this very object? */
function storeHolds(store, m) {
  if (!store || !m) return false;
  for (const lst of Object.values(store)) if (Array.isArray(lst) && lst.includes(m)) return true;
  return false;
}

export function pitchLabel(rise12) {
  if (!Number.isFinite(rise12)) return 'vertical';
  const r = Math.round(rise12 * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 0.05) return `${Math.round(r)}:12`;
  return `${r.toFixed(1)}:12`;
}

function patternLabel(key) {
  const row = TILE_PATTERNS.find(p => p[0] === key);
  return row ? row[1] : String(key || 'grid');
}

function trimNum(v, dp = 6) {
  return String(parseFloat((Number(v) || 0).toPrecision(dp)));
}

function formatDistanceLabel(ft, precision) {
  return formatDistancePrecision(ft, precision);
}

export { STANDALONE_PAGE };

// main.js — the app shell: open, save, draw, and everything that hangs off a menu.

import {
  openProject, writeProject, readProjectSummary, FILE_EXTENSION, LEGACY_EXTENSION,
  STANDALONE_PAGE,
} from './core/takeoff-file.js';
import { draftKey, putDraft, getDraft, dropDraft } from './core/drafts.js';
import { CalloutPreview } from './ui/callout-preview.js';
import { resolveUiMode } from './ui/settings.js';
import { RemoteFile } from './core/remote-file.js';
import {
  PlansFolders, idbBackend, fileStamp, changedSince, permissionOf, askPermission,
  resolvePlansSource, parsePlansLink, projectCodeOf,
} from './core/plans-folder.js';
import {
  PORTAL_INDEX_KEY, PORTAL_DIR, PORTAL_DB, PORTAL_TOKEN_KEY, PORTAL_FILE_RE, KEPT_INDEX_KEY, OWNER_KEY, OPEN_LOCK,
  libraryOwner, portalCopies, keptCopies, keepFile, keptFile, removeKept, removePortalCopy, sizeText,
} from './core/device-plans.js';
import { openAfterAsking } from './core/plans-link.js';
import {
  PORTAL_ORIGINS, HANDOFF_WAIT_MS, RENEW_WAIT_MS, parsePortalHash, isPortalOrigin, readyMessage, renewMessage,
  offlineMessage, openFromMessage, linkFromMessage,
} from './core/portal-handoff.js';
import { PlansArchive } from './ui/plans-archive.js';
import { PLANS_SOURCE } from './site-config.js';
import { PageStore } from './core/page-store.js';
import {
  Project, KEEPS_OWN_SCALE, takeoffFingerprint, resyncGroups,
} from './core/project.js';
import {
  CountingModel, applyBooking, takeoffMoveWords, takeoffQuantityWords, isTakeoffItem,
} from './core/counting.js';
import { importPdf, canvasToPng } from './core/pdf-import.js';
import {
  SCALE_PRESETS, EXTENDED_SCALES, computePixelsPerFoot, scaleLabelFor,
  DEFAULT_DPI, DEFAULT_PPF, formatFtIn, refScaleWords,
} from './core/units.js';
import { recompute } from './core/measure.js';
import { boundingBox } from './core/geom.js';
import { Viewport } from './render/viewport.js';
import { Renderer } from './render/renderer.js';
import { clampMarkerScale, MARKER_STEPS } from './render/markers.js';
import { calloutRadius } from './render/callouts.js';
import { setPaletteIndex } from './render/theme.js';
import {
  ToolController, TOOLS, TAKEOFF_TOOLS, MARKUP_TOOLS, HINTS, isMarkupTool,
  SCRATCH_CAPABLE,
} from './tools/controller.js';
import { HIGHLIGHT_COLORS, PEN_COLORS } from './tools/markup.js';
import { ItemsPanel } from './ui/items-panel.js';
import * as D from './ui/dialogs.js';
import { Settings } from './ui/settings.js';
import { openReportCenter } from './ui/reports.js';
import { openCatalog, loadCatalog } from './ui/catalog.js';
import { Thumbnails } from './ui/thumbnails.js';
import { ScratchStore } from './core/scratch.js';
import { VersionBar, sheetsWithRevisions } from './ui/version-bar.js';
import { RevisionsPanel } from './ui/revisions-panel.js';
import {
  visibleRevisions, sheetVersions, newestVersionOf, versionItems,
  revPageCount, revPageLabel, revisionLabel, workingVersionOf,
  sizesMatch, sizeRefusal, itemRevId,
} from './core/revisions.js';

const $ = id => document.getElementById(id);

const app = {
  project: new Project(),
  pages: new PageStore(),
  settings: new Settings(),
  // Temporary dimensions. Deliberately NOT on the project — see core/scratch.js.
  scratch: new ScratchStore(),
  currentPage: 0,
  fileHandle: null,
  fileName: '',
  // The Plans Library copy the open project reads its sheets from, and the
  // lock that keeps the portal from deleting it — null for any other file.
  // See openLibraryCopy().
  libraryCopy: null,
  // The open project lives in a Plans Archive folder on this computer:
  // { stamp, dir, folderName, path } — what the file was when it was opened,
  // so Save can tell when another computer saved it since. Null otherwise.
  // See openArchiveTakeoff() and checkArchiveWrite().
  archive: null,
  // Where Save As starts: the folder of the PDF this takeoff was started from.
  saveStartIn: null,
  // False is View Only, which is what a project opens in. See setEditing().
  editing: false,
};

const canvas = $('canvas');
const viewport = new Viewport(canvas);
const renderer = new Renderer(canvas, viewport);

const controller = new ToolController({
  canvas, viewport,
  project: app.project,
  currentPage: () => app.currentPage,
  host: {
    askItem: D.askItem,
    askSlopeRoof: D.askSlopeRoof,
    askTile: D.askTile,
    askCountItem: D.askCountItem,
    askCalibration: async ({ distPx }) => D.askCalibration({ distPx }),
    askNote: opts => D.askNote(opts),
    askCallout: opts => D.askCallout({
      ...opts,
      // Offer the sheets in this set, so a callout can point at one.
      sheets: Array.from({ length: app.pages.pageCount }, (_, i) => [i, pageFinalLabel(i)]),
    }),
    alert: D.alertDialog,
    openProperties: item => openProperties(item),
    showItemMenu: (item, ev) => showItemMenu(item, ev),
  },
});

const itemsPanel = new ItemsPanel({
  root: $('itemsPanel'),
  listEl: $('itemList'),
  floorFilterEl: $('floorFilter'),
  groupFilterEl: $('groupFilter'),
  costToggleEl: $('costToggle'),
  footEl: $('itemsFoot'),
  project: app.project,
  host: {
    pageLabel: idx => pageFinalLabel(idx),
    // The panel asks before it offers a control that writes.
    readOnly: () => controller.readOnly,
    selectItem: (m, pageIdx, ev) => {
      // A jump whose whole purpose is to put a piece of the user's own work
      // in front of them must land on the drawing that work was traced on.
      // Landing on the newest revision would hide the very item they clicked,
      // because an item is only painted over its own version of the sheet.
      if (pageIdx !== STANDALONE_PAGE) goToPage(pageIdx, { version: m.rev_id || '' });
      controller.select([m._uid]);
      const bb = boundingBox(m.points || []);
      if (bb.w || bb.h) viewport.ensureVisible(bb);
      requestDraw();
    },
    openProperties: item => openProperties(item),
    openMaterials: item => openMaterials(item),
    showItemMenu: (item, ev) => showItemMenu(item, ev),
  },
});

const thumbs = new Thumbnails({
  listEl: $('thumbList'),
  panelEl: $('thumbsPanel'),
  project: app.project,
  pages: app.pages,
  onPick: idx => goToPage(idx),
  // How many versions each sheet has beyond its own drawing, for the pips on
  // the cards. Recomputed only when the revision model changes — not per row.
  revisionCounts: () => revCountsBySheet,
  // Sliding a card sideways walks that sheet's drawings.
  onSlideVersion: (i, step) => slideSheetVersion(i, step),
  // Which sheet is off its newest drawing, and where in the run it sits.
  // Read from the app every time it paints rather than pushed in, so the red
  // frame and the drawing on screen cannot get out of step.
  // What each tile says about its sheet's drawings (CountingModel.
  // sheetTileStates), rebuilt by syncTiles() whenever it can change.
  tileStates: () => tileStates,
  versionState: () => {
    const page = app.currentPage;
    const vers = versionsOf(page);
    const cur = String(versionView.revId || '');
    return {
      page,
      old: showingOldVersion(),
      which: vers.length ? Math.max(0, vers.findIndex(v => v.revId === cur)) + 1 : 1,
      count: vers.length,
    };
  },
});

// ── plan revisions ────────────────────────────────────────────────────────

const versionBar = new VersionBar({
  root: $('versionBar'),
  pips: $('vbPips'),
  state: () => ({
    revs: allRevisions(),
    page: app.currentPage,
    sheetLabel: app.pages.pageCount ? pageFinalLabel(app.currentPage) : '',
    viewingRevId: versionView.revId,
    workingRevId: workingVersion(app.currentPage),
    order: latestOrder(),
    origins: sheetOrigin(),
    // Count this version moves a total, so it is live only in Edit Mode.
    canCount: app.editing,
  }),
  onPick: revId => showSheetVersion(app.currentPage, revId),
});

const revisionsPanel = new RevisionsPanel({
  root: $('revPanel'),
  state: () => ({
    revs: allRevisions(),
    page: app.currentPage,
    pageCount: app.pages.pageCount,
    viewingRevId: versionView.revId,
    extraSheets: app.project.metadata.extra_sheets || [],
    order: latestOrder(),
    origins: sheetOrigin(),
  }),
  host: {
    pageLabel: i => pageFinalLabel(i),
    showVersion: (page, revId) => showSheetVersion(page, revId),
    // The ORIGINAL column exists to show the project's OWN drawing, so it
    // holds the Newest tick rather than obeying it.
    showOwn: page => goToPageOwnVersion(page),
    showLoosePage: (rev, rp) => showLoosePage(rev, rp),
    setOrder: order => {
      app.settings.set('latest_set_order', order);
      // Which drawing is newest moves with the order, and the tiles say it.
      syncVersionUi({ rebuild: true });
    },
  },
});

/** Which sheets have more than one version. Rebuilt only when the model does. */
let revCountsBySheet = new Map();

/**
 * Everything that displays the version model, refreshed together.
 *
 * Cheap by construction: it reads counts and ids, never pixels. On a project
 * with no revisions the bar hides, the panel is empty and the thumbnails draw
 * exactly what they drew before this feature existed.
 */
function syncVersionUi({ rebuild = false } = {}) {
  if (rebuild) {
    revCountsBySheet = sheetsWithRevisions(app.pages.pageCount, allRevisions(), sheetOrigin());
    syncTiles({ paint: false });
    thumbs.syncLabels();
  }
  // A callout pin or a note whose revision has left this sheet is shown —
  // and can be clicked — on the sheet's own drawing (markVersion).
  controller.markOf = markOf;
  // The tools must know which drawing is under them BEFORE anything is
  // painted or clicked: the hit test filters on it, and it is what stops a
  // drag from moving work onto a drawing it was never traced on.
  //
  // syncModeUi owns `readOnly`, because it has TWO sources — the mode and
  // the version on screen — and one of them setting it while the other
  // clears it is exactly the disagreement that leaves an editable revision.
  controller.setVersionView(versionView.revId, versionView.revPage);
  syncModeUi();
  versionBar.refresh();
  revisionsPanel.refresh();
  const on = browsingOtherVersion();
  $('vbOverlay')?.classList.toggle('on', overlayActive());
  syncOldBadge();
  thumbs.syncVersions();
  // A version on screen is a look, not a place to draw — say so on the canvas
  // rather than only in the status line, which scrolls away.
  canvas.classList.toggle('on-version', on);
}

/**
 * The translucent OLD over the corner of the sheet.
 *
 * Hidden on the overwhelming majority of sheets, which have one drawing and
 * nothing to be old about. It names which of the run is on screen, because
 * "this is not the newest" is the warning and "it is the second of four" is
 * what tells you how far back you have gone.
 */
function syncOldBadge() {
  const el = $('oldBadge');
  if (!el) return;
  const old = showingOldVersion();
  el.hidden = !old;
  if (!old) return;
  const vers = versionsOf(app.currentPage);
  const cur = String(versionView.revId || '');
  const which = Math.max(0, vers.findIndex(v => v.revId === cur)) + 1;
  const what = vers[which - 1];
  const label = cur && what ? what.label : 'original';
  $('oldBadgeSub').textContent = vers.length > 1
    ? `${label} · ${which} of ${vers.length}`
    : label;
}

// ── render loop ───────────────────────────────────────────────────────────

let drawQueued = false;
let pageImage = null;
// A fit that could not run because the canvas had no size yet. Retried on the
// first frame that has one, so a project opened in a background tab still
// lands framed rather than at 2%.
let pendingFit = false;

function requestDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    drawFrame();
  });
}

function drawFrame() {
  viewport.resize();
  if (pendingFit && pageImage && viewport.measured) {
    if (applyDefaultZoom()) pendingFit = false;
  }
  renderer.markerScale = app.settings.get('marker_scale');
  renderer.uiScale = uiMode() === 'touch' ? 1.6 : 1.0;
  renderer.background = app.settings.get('background_color');
  renderer.pageDpi = app.project.dpi;
  controller.calloutRadiusPx = calloutRadius({
    dpi: app.project.dpi, zoom: viewport.zoom,
    markerScale: app.settings.get('marker_scale'),
  });
  // Which drawing, and whose work on it. While another version of this sheet
  // is up, the takeoff shown is the work traced on THAT drawing — never the
  // sheet's own, which was taken off different lines. Markup and notes belong
  // to the sheet's own drawing and are held. On a project with no revisions
  // this is the identical expression it always was.
  const onRev = browsingOtherVersion();
  const shown = onRev ? versionView.bitmap : pageImage;
  const onPage = app.project.measurements[app.currentPage] || [];
  // Filtering allocates a new array, and this runs once per animation frame —
  // so on a job with no revisions at all, which is most of them, the list is
  // passed straight through exactly as it was before this feature existed.
  const hasRevisions = (app.project.metadata.revisions || []).length > 0;
  // Temporary dimensions ride along with the real items, so every pass that
  // draws an item — geometry, markers, labels — draws them too. They carry
  // `scratch: true`, which is what makes them dash, and they come from a
  // store no save can reach.
  const real = (onRev || hasRevisions)
    ? versionItems(onPage, versionView.revId, versionView.revPage, markOf)
    : onPage;
  // Temporary dimensions go through the SAME version filter as real ones.
  // A dimension read off a revision belongs to that drawing; drawn after the
  // flip back it would lie across the original at a length taken from lines
  // that are not under it.
  const temp = versionItems(app.scratch.forPage(app.currentPage),
    versionView.revId, versionView.revPage);
  renderer.draw({
    pageImage: shown,
    items: temp.length ? [...real, ...temp] : real,
    annotations: onRev ? [] : (app.project.annotations[app.currentPage] || []),
    overlay: overlayFrame(),
    // Isolation is a way of looking at the TAKEOFF — "show only these items".
    // A temporary dimension is not one of them, and letting isolation swallow
    // it meant measuring in View Only reported a length, bumped the counter,
    // and drew nothing at all.
    isVisible: m => (m.scratch ? m.visible !== false : app.project.isVisible(m)),
    selected: controller.selected,
    hoverId: controller.hoverId,
    hoverVertex: controller.hoverVertex,
    dragVertex: controller.dragVertex,
    preview: controller.previewState(),
    markup: controller.markupPreview(),
    ppf: app.project.pagePpf(app.currentPage),
  });
  $('zoomLabel').textContent = `${Math.round(viewport.zoom * 100)}%`;
}

controller.addEventListener('changed', () => { requestDraw(); syncMobileBar(); });

/* ── the callout preview ───────────────────────────────────────────────
 *
 * A bubble that says "3/S301" is a question, and following it by hand costs
 * four navigations and your place on the sheet. Tapping it answers the
 * question where you are standing.
 */
const calloutPreview = new CalloutPreview({
  // A GETTER, not the store itself. newProject() and every open replace
  // app.pages with a new PageStore, and this object literal would
  // otherwise hold the one that existed at module load for ever — the
  // assignment further down that meant to re-point it was writing a
  // property the widget never reads, so the preview went on cropping the
  // previous job's sheets, which is exactly what its comment feared.
  get pages() { return app.pages; },
  sheetLabel: i => pageFinalLabel(i),
  goToSheet: i => { void goToPage(i); },
  sizeName: () => app.settings.get('preview_popup_size') || 'medium',
  // His own wheel preference, the same two it means on the sheet.
  wheelMode: () => app.settings.get('wheel_mode') || 'zoom',
  zoomStep: () => app.settings.get('zoom_step_percent') || 15,
  // A preview that has closed itself — the pointer left it, or Escape was
  // pressed over one — must leave the canvas able to open the same bubble
  // again. See Controller.clearHoverState.
  hoverEnded: () => controller.clearHoverState(),
});

controller.addEventListener('callout-activated', ev => {
  const { item, x, y } = ev.detail;
  void calloutPreview.show(item, x, y, { pinned: true });
});

// Hover is a mouse affordance; the controller only emits it for a mouse.
controller.addEventListener('callout-hover', ev => {
  const { item, x, y } = ev.detail;
  if (item) calloutPreview.hoverIn(item, x, y);
  else calloutPreview.hoverOut();
});

// A pinned preview belongs to the user until they dismiss it. Capture phase,
// so it closes before the press does anything else — but never when the
// press landed inside the preview itself.
document.addEventListener('pointerdown', ev => {
  if (!calloutPreview.open) return;
  if (ev.target.closest && ev.target.closest('#calloutPreview')) return;
  calloutPreview.hide();
}, true);
controller.addEventListener('selection-changed', ev => {
  itemsPanel.setSelection(ev.detail.ids);
});
controller.addEventListener('status', ev => setStatus(ev.detail.text));
// Every finished item passes through controller._file, which says so here.
controller.addEventListener('takeoff-filed', ev => { void onTakeoffFiled(ev.detail); });
controller.addEventListener('mode-changed', ev => {
  for (const wrap of [$('toolButtons'), $('viewToolButtons'), $('markupButtons')]) {
    for (const b of wrap.children) {
      b.classList.toggle('on', b.dataset.mode === ev.detail.mode);
    }
  }
  syncToolOptions(ev.detail.mode);
  syncMarkupWidth();
});

app.project.addEventListener('items-changed', () => {
  itemsPanel.refresh();
  requestDraw();
  // What counts can change with any edit: the tiles' ⚠, and the sentence
  // owed when a sheet comes to hold takeoff that does not count.
  syncTiles();
  watchCounted();
});
// An undo or redo moved a booking a takeoff had made: said, by quantity.
app.project.addEventListener('booking', ev => sayBookingUndo(ev.detail));
app.project.addEventListener('visibility-changed', () => requestDraw());
app.project.addEventListener('annotations-changed', () => requestDraw());
app.project.addEventListener('history-changed', ev => {
  syncHistoryButtons();
  if (ev.detail && ev.detail.cleared && ev.detail.reason) {
    setStatus(`Undo history cleared — ${ev.detail.reason}.`);
  }
});
app.project.addEventListener('dirty-changed', syncTitle);
app.project.addEventListener('scale-changed', () => {
  syncScaleSelect();
  itemsPanel.refresh();
  requestDraw();
});
app.project.addEventListener('pages-changed', ev => {
  // Temporary dimensions are keyed by page index like everything else, so an
  // inserted or deleted sheet moves them. Left behind, a dimension taken on
  // sheet 6 would be drawn over whatever sheet took that number.
  const { at, delta } = ev.detail || {};
  if (Number.isFinite(at) && Number.isFinite(delta)) {
    app.scratch.shiftPages(at, delta);
    // Both are keyed by page index: a sheet in or out re-keys every one.
    countAsked.clear();
    primeWatch();
  }
  // The MODEL shifts with the pages — notePagesInserted / notePageRemoved run
  // shiftRevisionIndices over every match map. The cached count-per-sheet does
  // not, and it is what the dots on the cards are drawn from: left stale, row
  // N shows row N+1's revisions after a single delete. A sheet reissued twice
  // would show none and get skipped. So rebuild, not just re-label.
  syncVersionUi({ rebuild: true });
  thumbs.refresh(app.currentPage);
  syncPageOf();
});

new ResizeObserver(() => requestDraw()).observe($('stage'));

// ── pages ─────────────────────────────────────────────────────────────────

// Every goToPage call takes a ticket. A decode that finishes after the user
// has moved on must not paint its sheet under another sheet's takeoff — on a
// 25 MB sheet that window is seconds wide.
let pageTicket = 0;

/**
 * Go to a sheet.
 *
 * `version` says which drawing of it to land on: omit it and the Newest tick
 * decides, pass '' to insist on the sheet's own drawing, or pass a rev_id for
 * a particular one. Every jump whose PURPOSE is to put the user's own work in
 * front of them passes '' — landing on a revision there would hide the very
 * item that was asked for, since work is only painted over the drawing it was
 * traced on.
 */
async function goToPage(index, { version } = {}) {
  if (index < 0 || index >= app.pages.pageCount) return;
  const ticket = ++pageTicket;
  const first = app.currentPage !== index || !pageImage;
  const movedSheet = app.currentPage !== index;
  app.currentPage = index;
  app.project.metadata.last_viewed_page = index;
  // The version on screen belonged to the sheet we just left, and so did the
  // overlay. Both are dropped here; what the new sheet shows is decided below,
  // after its own drawing has been decoded.
  clearVersion({ draw: false });
  if (movedSheet) clearOverlay({ draw: false });
  controller.cancel();
  thumbs.setCurrent(index);
  syncPageOf();
  syncScaleSelect();
  itemsPanel.refresh();

  let decoded = null;
  try {
    decoded = await app.pages.getPage(index);
  } catch (err) {
    if (ticket === pageTicket) {
      pageImage = null;
      setStatus(`Could not open sheet ${index + 1} — ${err.message}`);
      // Without this the version bar goes on claiming a revision is up on a
      // sheet that has no drawing at all, and readOnly stays stuck true with
      // no Original to press.
      syncVersionUi();
      requestDraw();
    }
    return;
  }
  if (ticket !== pageTicket) return;   // the user has moved on; drop this one

  pageImage = decoded;
  if (first && pageImage) pendingFit = !applyDefaultZoom();

  // Which drawing of this sheet to show. Resolved AFTER the sheet's own image
  // is in hand, so the scale check has something to compare against and a
  // failed revision decode still leaves a usable sheet on screen.
  const want = version === undefined
    ? newestOf(index)                 // unasked, you get the newest
    : String(version || '');

  // Prefetching the neighbouring SHEETS is what makes paging smooth — but not
  // while a revision is being carried across the set. Those two decodes are
  // 28 megapixels each and go straight under a drawing that covers them, and
  // they evict the four-slot LRU that the flip back to the original depends
  // on. Walking the 93 sheets of one revision would be 372 full decodes where
  // 93 would do.
  app.pages.prefetchAround(index, want ? 0 : 1);
  requestDraw();

  syncVersionUi();
  if (want) await showSheetVersion(index, want, { announce: false, flip: false });
}

/* ══════════════════════════════════════════════════════════════════════
   View Only mode

   A project opens in View Only, and that is the right default for a browser:
   most of the time a set of drawings is opened to be READ — on a phone, on a
   tablet in a truck, from a link in the portal — and the reader is not the
   estimator who drew it. Two things follow.

   IT CANNOT BE CHANGED BY ACCIDENT. Not "changes are discouraged": the drag
   is never armed, Delete is refused, double-click does not open the editor,
   the item menu does not open, and every tool that would put something in the
   project is held. Selecting still works, because clicking a wall to read
   what it is is looking, not editing.

   THERE IS MORE DRAWING. The thirteen takeoff tools, the markup row, the
   undo/redo pair and the items panel are all for producing work, and none of
   them earns its space while reading. They go, and the sheet gets the room.

   What View Only KEEPS is the ability to measure — see core/scratch.js. A
   dimension you take to read a drawing is not takeoff, and it is never saved.
   ══════════════════════════════════════════════════════════════════════ */

/** The tools View Only offers: read a length, an area, a pitch. */
const VIEW_TOOLS = [
  ['pan', 'Pan / Select'],
  ...TAKEOFF_TOOLS.filter(([m]) => SCRATCH_CAPABLE.has(m)),
];

/**
 * Switch between View Only and Edit Mode.
 *
 * `announce` is false when a project is being opened, where the mode is not
 * news — the status line has more useful things to say.
 */
function setEditing(on, { announce = true } = {}) {
  const want = !!on;
  const changed = app.editing !== want;
  app.editing = want;

  if (changed) {
    // Whatever was half-drawn belonged to the other mode.
    controller.cancel();
    controller.selected.clear();
    controller.setMode('pan');
  }
  // NOT guarded by `changed`. Opening a project calls this with the mode it is
  // already in — false, on a fresh load — and the panels still have to be put
  // the right way round. Both of these are idempotent for exactly that reason.
  if (want) restorePanelsForEdit(); else tidyPanelsForView();

  if (changed && announce) {
    setStatus(want
      ? 'Edit Mode — the takeoff tools are live and changes are saved with the project.'
      : 'View Only — nothing here can change the project. You can still measure; '
        + 'those dimensions are temporary and are never saved.');
  }
  // syncModeUi owns the items-panel refresh now — it is the one place that
  // moves controller.readOnly, and the rows are built from it.
  syncModeUi();
  // Count this version is live only in Edit Mode: the bar re-reads the mode.
  versionBar.refresh();
  requestDraw();
}

/**
 * Everything the mode governs, in one place.
 *
 * Called on every mode change, every project open and every version flip,
 * because read-only has two independent sources — the mode, and looking at
 * another version of a sheet — and they must never disagree about it.
 */
function syncModeUi() {
  const open = app.pages.pageCount > 0;
  const editing = app.editing;
  const onVersion = browsingOtherVersion();
  const wasReadOnly = controller.readOnly;

  // A revision re-issued on other paper has a different number of pixels to
  // the foot, and the scale belongs to the SHEET. A dimension taken on it
  // would be read against a scale it was never measured with — a wrong
  // number, quietly — so measuring is refused there, not silently wrong.
  const sizeOk = !onVersion || sizesMatch(
    pageImage ? { width: pageImage.width, height: pageImage.height } : null,
    versionView.size);

  // THE gate. Read-only if the mode says so, if this drawing has been
  // SUPERSEDED, or if it is a different paper size.
  //
  // It used to ask `onVersion` — is any revision on screen — which was the
  // same question while the sheet's own drawing was the default. It is not
  // any more: the newest drawing is what you get, so asking that made every
  // reissued sheet in the job read-only, with the estimator's own takeoff
  // hidden under a drawing they could not draw on. What actually makes a
  // drawing unsafe to trace on is that it is out of date, or that the scale
  // would be wrong, so those are what it asks.
  //
  // With NOTHING open there is nothing to protect, and saying "read-only"
  // there would refuse the three actions that CREATE a project — Add Blank
  // Sheet, Add Item Not on a Sheet, the Materials Catalog — while hiding the
  // very button that would let the user out of it.
  const superseded = showingOldVersion();
  controller.readOnly = open && (!editing || superseded || !sizeOk);

  controller.readOnlyReason = superseded
    ? 'This is an older drawing of this sheet. Slide the sheet card to the '
      + 'right, or press Newest, to come back to the current one.'
    : !sizeOk
      ? sizeRefusal(
        pageImage ? { width: pageImage.width, height: pageImage.height } : null,
        versionView.size)
      : 'This is View Only mode. Press Edit Mode to change the takeoff.';
  // Where a finished measurement goes, and the rule is one sentence: you can
  // always measure; whether it is SAVED depends on whether you can edit.
  //
  // So the sink follows readOnly rather than the mode. That also covers Edit
  // Mode with another version of a sheet on screen — reading a dimension off
  // a revision is a fair thing to want, and it cannot be takeoff, because the
  // work would belong to a drawing the estimator is only looking at.
  //
  // The item is STAMPED with the version it was taken on, exactly as a real
  // measurement is. Without that, a dimension read off a revision goes on
  // being drawn after the flip back — lying across the original drawing, at
  // a length taken from lines that are not under it.
  controller.scratchSink = (controller.readOnly && sizeOk)
    ? (m => app.scratch.add(app.currentPage, {
        ...m,
        ...(versionView.revId
          ? { rev_id: versionView.revId, rev_page: versionView.revPage }
          : null),
      }))
    : null;
  document.body.classList.toggle('view-only', !editing && open);
  const btn = $('modeBtn');
  btn.hidden = !open;
  btn.textContent = editing ? 'View Only' : 'Edit Mode';
  btn.classList.toggle('editing', editing);
  btn.title = editing
    ? 'Leave Edit Mode — more room for the drawing, and nothing can be changed'
    : 'Enter Edit Mode to draw, measure and change the takeoff';
  // The same switch in the phone's foot bar: the menubar's copy scrolls off a
  // 375px screen, and a phone is exactly where View Only earns its keep.
  const mLabel = $('mbarModeLabel');
  if (mLabel) mLabel.textContent = editing ? 'View' : 'Edit';
  const mBtn = $('mbarMode');
  if (mBtn) { mBtn.hidden = !open; mBtn.classList.toggle('on', editing); }

  // With nothing open, the toolbar stays as it always was — a View Only row
  // over an empty stage offers tools with no sheet to use them on, and no
  // badge or button to say what mode that even is.
  const viewChrome = open && !editing;
  $('toolButtons').hidden = viewChrome;
  $('viewToolButtons').hidden = !viewChrome;
  $('undoBtn').hidden = viewChrome;
  $('redoBtn').hidden = viewChrome;
  // Driven by the GATE, not the mode: setting a scale writes page_scales, and
  // it must be as unavailable on a revision as Sheets ▸ Set Sheet Scale is.
  $('scaleSelect').disabled = controller.readOnly;

  // The item rows carry Hide and Materials buttons only when those would
  // work, so the list has to be rebuilt whenever the gate moves. Here rather
  // than in the callers: readOnly has two sources, and the one that changes
  // it on a version flip had no idea the panel cared.
  if (wasReadOnly !== controller.readOnly) itemsPanel.refresh();

  syncScratchUi();
  for (const [id, on] of [['modeViewItem', !editing], ['modeEditItem', editing]]) {
    const el = $(id);
    if (el) el.textContent = (on ? '✓ ' : '') + (id === 'modeViewItem' ? 'View Only' : 'Edit Mode');
  }
}

/**
 * What the panels looked like before View Only tidied them away.
 *
 * Restored on the way back out, so an estimator who had already closed the
 * items panel in Edit Mode does not find it reopened — and, just as
 * importantly, one who OPENS it while reading does not have it snap shut
 * again on the next page turn. That is why this lives in the mode TRANSITION
 * and not in syncModeUi, which runs on every navigation.
 */
let panelsBeforeView = null;

function tidyPanelsForView() {
  if (panelsBeforeView) return;            // already tidied; do not re-tidy
  const body = document.querySelector('.body');
  panelsBeforeView = {
    items: body.classList.contains('no-items'),
    markup: $('markupBar').hidden,
  };
  body.classList.add('no-items');
  $('markupBar').hidden = true;
}

function restorePanelsForEdit() {
  if (!panelsBeforeView) return;
  const body = document.querySelector('.body');
  body.classList.toggle('no-items', panelsBeforeView.items);
  $('markupBar').hidden = panelsBeforeView.markup;
  panelsBeforeView = null;
}

function syncScratchUi() {
  const n = app.scratch.count;
  // Visible wherever there is something to undo or clear, whichever mode that
  // is — taking the last dimension away must also take its controls away, and
  // taking the first one must bring them back.
  const grp = $('viewMeasureGroup');
  if (grp) grp.hidden = !(app.pages.pageCount && (!app.editing || n));
  const out = $('scratchCount');
  if (out) {
    out.textContent = n ? `${n} temporary` : '';
    out.title = n
      ? `${n} temporary dimension${n === 1 ? '' : 's'} — not saved with the project`
      : '';
  }
}

app.scratch.addEventListener('changed', () => { syncScratchUi(); requestDraw(); });

/* ══════════════════════════════════════════════════════════════════════
   Plan revisions — looking at another version of a sheet

   A revision set is a re-issue of part of the drawing set. It lives alongside
   the original sheets rather than replacing them, because the takeoff on a
   sheet was traced over THAT sheet's lines, and moving it to a different
   drawing would put measurements on lines they were never taken from.

   So "showing a revision" is a swap of the picture and of nothing else:

     · the drawing on screen changes; zoom and pan do not
     · the takeoff shown is the work traced on the version on screen. For a
       project made before revisions could be taken off, that means the
       sheet's own work when its own drawing is up and nothing at all when a
       revision is up — which is the honest answer, not a gap
     · markup belongs to the sheet's own drawing, so it is held
     · the project is not touched. Looking is not an edit: it must not move
       last_viewed_page, must not mark the file dirty, and must not be undoable

   NOTHING HERE READS THE WHOLE FILE. One revision sheet is fetched, by
   File.slice(), at the moment it goes on screen. On the estimator's largest
   job the eleven revision sets come to 1.42 GB.
   ══════════════════════════════════════════════════════════════════════ */

const versionView = {
  revId: '',        // '' = the sheet's own drawing
  revPage: null,    // which page of that revision stands in for this sheet
  set: -1,          // which blob set in the tail, for the page store
  bitmap: null,     // the decoded revision sheet, or null
  size: null,       // its true pixel size, for the scale check
};

// A decode that was in flight when the user moved on must not paint. Same
// reason goToPage carries a ticket: a revision sheet is 21–120 ms to decode,
// and clicking down a column of the matrix is faster than that.
let versionTicket = 0;

/** Every revision record, including the hidden ones. */
function allRevisions() {
  return app.project.metadata.revisions || [];
}

/** metadata.sheet_origin: the revision page each ADDED sheet IS. */
function sheetOrigin() {
  return app.project.metadata.sheet_origin || null;
}

/** Every drawing of one sheet — never its own origin page as a "version". */
function versionsOf(page) {
  return sheetVersions(page, allRevisions(), sheetOrigin());
}

/* ══════════════════════════════════════════════════════════════════════
   What counts

   A sheet can carry takeoff on several of its drawings and exactly ONE of
   them is in the totals (core/counting.js, the desktop's rule, held to it by
   tests/revision-counting.mjs). Everything here SAYS what moved: a quantity
   that reaches the estimate never changes without a sentence on screen that
   names the quantity — and looking never moves one.
   ══════════════════════════════════════════════════════════════════════ */

/** The sizes the "another sheet size" rule asks about, as far as known. */
function pageSizeOf(page) {
  if (page === app.currentPage && pageImage) return [pageImage.width, pageImage.height];
  const src = (app.pages.sources || [])[page];
  return src && src.width && src.height ? [src.width, src.height] : null;
}

function revSizeOf(rev, rp) {
  if (versionView.revId && String(rev.id) === versionView.revId
      && rp === versionView.revPage && versionView.size) {
    return [versionView.size.width, versionView.size.height];
  }
  const s = app.pages.peekRevisionPageSize?.(rev._setIndex, rp);
  return s ? [s.width, s.height] : null;
}

/** The counting rule, asked of the project as it stands now. */
function countingModel() {
  return new CountingModel({
    metadata: app.project.metadata, measurements: app.project.measurements,
    pageCount: app.pages.pageCount, order: latestOrder(),
    sizeOf: pageSizeOf, revSizeOf,
  });
}

/** [revId, revPage] of the drawing a pin or note is SHOWN on. */
function markOf(m) {
  return countingModel().markVersion(app.currentPage, m);
}

/** {page: tile state} — what each Pages tile says (sheetTileStates). */
let tileStates = {};

function syncTiles({ paint = true } = {}) {
  tileStates = app.pages.pageCount ? countingModel().sheetTileStates() : {};
  if (paint) thumbs.syncTiles();
}

/**
 * A sentence about money. Said AFTER whatever else this operation says, on
 * the end of the line rather than over it, and kept up long enough to read
 * (the desktop's _announce_price): "Added item" written a moment later must
 * not bury "250 sq ft of Wall leaves".
 */
let priceQueue = [];
// The line as the last price sentence left it: a NEW operation's sentence
// replaces it rather than growing a paragraph of every move this minute.
let priceShown = '';
function sayPrice(text) {
  // `text` may be a function that WORDS the sentence when it is said: what
  // an operation ended up doing is known only once it is over.
  if (!text) return;
  if (!priceQueue.includes(text)) priceQueue.push(text);
  if (priceQueue.length > 1) return;
  setTimeout(() => {
    const said = priceQueue.map(t => (typeof t === 'function' ? t() : t))
      .filter(Boolean).join(' ');
    priceQueue = [];
    if (!said) return;
    const now = $('statusText').textContent || '';
    const lead = now && !now.includes(said) && now !== priceShown
      && now !== (HINTS[controller.mode] || 'Ready')
      ? `${now.replace(/\s+$/, '')} — ` : '';
    priceShown = lead + said;
    $('statusText').textContent = priceShown;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      $('statusText').textContent = HINTS[controller.mode] || 'Ready';
    }, 20000);
  }, 0);
}

// ── the watch: a sheet whose counted drawing holds nothing ──────────────
let countedSeen = null;

/** Start the watch over in silence: a job opened, a draft restored. */
function primeWatch() {
  countedSeen = app.pages.pageCount ? countingModel().countedState() : null;
}

function watchCounted() {
  if (!app.pages.pageCount) return;
  const model = countingModel();
  const said = countedSeen ? model.watchSentence(countedSeen) : '';
  countedSeen = model.countedState();
  if (said) sayPrice(said);
}

/** Which sheet+drawing has been asked about this session (desktop: per job). */
const countAsked = new Set();

/**
 * Takeoff was just filed (controller._file). Say what its booking did, and
 * when it landed on a drawing its sheet does not count from, ask — once per
 * sheet and drawing — with the before and the after.
 */
async function onTakeoffFiled({ page, item, booking, level }) {
  // Worded when said, on the job as the filing left it (desktop
  // _book_first_takeoff): what came into the totals, by quantity.
  if (booking && booking.says) {
    sayPrice(() => countingModel().firstTakeoffSaid(page, booking.rid, booking.before));
  }
  syncVersionUi();
  if (!item || !isTakeoffItem(item) || !(page >= 0)) return;
  const model = countingModel();
  if (model.itemCountsTowards(page, item)) return;
  const key = `${page}\u0000${itemRevId(item)}\u0000${item.rev_page ?? ''}`;
  if (countAsked.has(key)) return;
  countAsked.add(key);
  // After the tool has finished with the click: a modal in the middle of a
  // pointer handler is a modal in the middle of a half-made item.
  await new Promise(r => setTimeout(r, 0));
  await askCountAfterTakeoff(page, item, level, key);
}

/** Is `item` still filed on `page`? (by identity: the row is a snapshot) */
function stillOn(page, item) {
  return (app.project.measurements[page] || []).includes(item);
}

async function askCountAfterTakeoff(page, item, level, key) {
  let model = countingModel();
  if (!stillOn(page, item) || model.itemCountsTowards(page, item)) {
    countAsked.delete(key);           // taken back, or counted since
    return;
  }
  const rid = itemRevId(item);
  const lead = model.afterTakeoffLead(page, item);
  const q = model.countQuestion(page, rid, lead);
  if (!q) return;
  if (q.refused) {
    setStatus(q.refused);
    sayPrice(model.declinedSentence(page, item));
    return;
  }
  const sheet = model.pageLabel(page);
  const fpBefore = takeoffFingerprint((app.project.measurements[page] || []).filter(x => x !== item));
  const ok = await D.confirmDialog('Which drawing does this sheet count from?', q.body,
    { okLabel: `Count ${model.versionName(rid)}` });
  // Asked again AFTER the answer: the dialog is a pause in which the job
  // can move. Acted on only while every fact he was shown is still true.
  model = countingModel();
  if (!stillOn(page, item)) {
    setStatus(`${sheet} was not changed: that takeoff is no longer on it.`);
    return;
  }
  if (!ok) {
    if (model.workingVersionOf(page) !== rid) sayPrice(model.declinedSentence(page, item));
    return;
  }
  const q2 = model.countQuestion(page, rid, lead);
  if (!q2 || q2.body !== q.body) {
    setStatus(`${sheet} was not changed: what is taken off it changed while the question was `
      + 'open. Count this version again to see the numbers as they are now.');
    return;
  }
  const before = model.countedQuantities();
  const ch = model.workingVersionChange(page, rid);
  if (!ch) return;
  applyBooking(app.project.metadata, ch);
  resyncGroups(app.project);
  app.project.markDirty();
  // His Yes exists because of that takeoff, so it rides the takeoff's undo
  // level: Ctrl+Z of the takeoff takes the Yes back too. A level the history
  // has moved past is not tagged — the Yes is then his own.
  app.project.tagBooking(level, { kind: 'asked', page, was: ch.was, now: rid,
    fpBefore, fpAfter: takeoffFingerprint(app.project.measurements[page] || []) });
  const after = countingModel();
  sayPrice(after.bookedSentence(page, rid, ch.was, before, after.countedQuantities()));
  afterBookChange();
}

/** Everything that shows which drawing counts, after the book moved. */
function afterBookChange() {
  primeWatch();
  syncTiles();
  itemsPanel.refresh();
  syncVersionUi();
  requestDraw();
  syncTitle();
}

/** An undo or redo moved a booking (Project._restoreKeepingBook). */
function sayBookingUndo({ page, direction, kind, to, bookBefore, prior: was }) {
  const model = countingModel();
  // From the job as it stood BEFORE the step (its takeoff included): read
  // after the restore, Ctrl+Z of a Yes named only what came back.
  const prior = was
    ? new CountingModel({ metadata: was.metadata, measurements: was.measurements,
      pageCount: was.pageCount, order: latestOrder(), sizeOf: pageSizeOf, revSizeOf })
    : model.variant({ sheetVersion: bookBefore });
  const moved = takeoffMoveWords(prior.countedQuantities(), model.countedQuantities());
  const sheet = model.pageLabel(page);
  setStatus(direction === 'undo' ? 'Undone.' : 'Redone.');
  if (kind === 'asked') {
    sayPrice(`${sheet} counts from ${model.versionName(to)} again, `
      + `${direction === 'undo' ? 'as it did before your Yes' : 'as you said Yes to'} — `
      + `${moved ? `in your totals: ${moved}` : 'your totals did not change'}.`);
  } else if (direction === 'undo') {
    sayPrice(`${sheet} has no takeoff on any drawing again, so it is back to counting from `
      + `${model.versionName(model.workingVersionOf(page))}, as before — the next takeoff on it decides`
      + `${moved ? `; in your totals: ${moved}` : ''}.`);
  } else {
    sayPrice(`${sheet} counts from ${model.versionName(to)} again — the drawing that takeoff is on`
      + `${moved ? `; in your totals: ${moved}` : ''}.`);
  }
  primeWatch();
}

/**
 * Count this version: the ONE control that moves a total without anything
 * being drawn. Shows the before and the after, changes nothing until he says
 * yes, and is NOT in the undo history — an undo of an older edit must never
 * take back a choice he made since (Project._restoreKeepingBook).
 */
async function countThisVersion() {
  if (!app.pages.pageCount) return;
  if (!app.editing) {
    setStatus('View Only — press Edit Mode to change which drawing a sheet counts from.');
    return;
  }
  const page = app.currentPage;
  const rid = String(versionView.revId || '');
  let model = countingModel();
  const sheet = model.pageLabel(page);
  if (model.workingVersionOf(page) === rid) {
    setStatus(`${sheet} already counts from ${model.versionName(rid)}.`);
    return;
  }
  const q = model.countQuestion(page, rid);
  if (!q || q.refused) {
    if (q) await D.alertDialog('That drawing cannot be taken off', q.refused);
    return;
  }
  const ok = await D.confirmDialog('Which drawing does this sheet count from?', q.body,
    { okLabel: 'Count this version' });
  if (!ok) return;
  if (app.currentPage !== page || String(versionView.revId || '') !== rid) {
    setStatus(`${sheet} was not changed: another drawing came up while the question was open.`);
    return;
  }
  model = countingModel();
  const q2 = model.countQuestion(page, rid);
  if (!q2 || q2.body !== q.body) {
    setStatus(`${sheet} was not changed: what is taken off it changed while the question was `
      + 'open. Count this version again to see the numbers as they are now.');
    return;
  }
  const before = model.countedQuantities();
  const ch = model.workingVersionChange(page, rid);
  if (!ch) return;
  applyBooking(app.project.metadata, ch);
  // The one place a total moves without a takeoff: multi-sheet items re-add
  // the runs that count now (desktop set_working_version -> resync).
  resyncGroups(app.project);
  app.project.markDirty();
  const after = countingModel();
  sayPrice(after.bookedSentence(page, rid, ch.was, before, after.countedQuantities()));
  afterBookChange();
}

/**
 * Opening a job: takeoff that is not in the totals because its sheet counts
 * another drawing is SAID, by quantity and sheet (the desktop says the same
 * line on every opening after a No). Nothing is changed — a job opens worth
 * exactly what it was worth.
 */
function sayLeftOutAtOpen() {
  const model = countingModel();
  const lone = model.loneUncountedSheets();
  if (lone.length) sayPrice(model.leftOutSentence(lone, 'Not in your totals'));
}

/** Whether a version of the sheet, rather than the sheet itself, is on screen. */
function browsingOtherVersion() {
  return !!versionView.revId;
}

/**
 * Which version of a sheet the TOTALS are counted from.
 *
 * Read out of metadata and nowhere else — not the newest, not the one on
 * screen, not the one with work on it. Looking must never move a price.
 * Resolved against every revision, hidden ones included, because hiding a
 * revision is a way of looking.
 */
function workingVersion(page) {
  return workingVersionOf(page, allRevisions(), app.project.metadata.sheet_version);
}

/** How "newest" is decided. Shared by the bar, the matrix and the current set. */
function latestOrder() {
  return app.settings.get('latest_set_order') === 'column' ? 'column' : 'date';
}

/**
 * The newest drawing of a sheet, or '' when the sheet's own IS the newest.
 *
 * This used to be a mode with a tick beside it. It is the behaviour now: a
 * superseded sheet is the one mistake in this whole feature that the numbers
 * can never show you afterwards, so looking at an old one has to be something
 * you did on purpose, not something you forgot to turn on.
 */
function newestOf(page) {
  return newestVersionOf(page, allRevisions(), latestOrder(), sheetOrigin());
}

/** Is the drawing on screen something other than the newest of its sheet? */
function showingOldVersion() {
  if (!app.pages.pageCount) return false;
  return String(versionView.revId || '') !== String(newestOf(app.currentPage) || '');
}

/** Put the sheet's own drawing back. Draws; touches nothing else. */
function clearVersion({ draw = true } = {}) {
  if (!versionView.revId && !versionView.bitmap) return false;
  versionTicket += 1;
  versionView.revId = '';
  versionView.revPage = null;
  versionView.set = -1;
  versionView.bitmap = null;
  versionView.size = null;
  app.pages.lruSize = MAIN_LRU;
  controller.cancel();
  if (draw) { syncVersionUi(); requestDraw(); }
  return true;
}

// How many decoded sheets to keep while nothing is being compared, and while
// something is.
//
// One sheet of the largest real job is 6300×4500 = 108 MB as RGBA. Four of
// those, plus the two in the revision cache, is 648 MB of resident bitmaps —
// and a phone, where the canvas cap reduces each to about 67 MB, still
// reaches 400 MB, which is past where iOS starts discarding the tab.
//
// While a version IS up, the main cache only has to hold the sheet being
// compared against, so it is cut to two: that sheet and one neighbour. The
// prefetch is off in the same state, so nothing refills it behind the
// drawing on screen.
const MAIN_LRU = 4;
const MAIN_LRU_COMPARING = 2;

/**
 * Put one version of one sheet on the main screen.
 *
 * `revId` of '' means the sheet's own drawing. Asking for the version already
 * on screen flips back to the original — that back-and-forth is what makes a
 * change jump out, and it is how the desktop behaves.
 */
async function showSheetVersion(page, revId, { announce = true, flip = true } = {}) {
  if (!(page >= 0 && page < app.pages.pageCount)) return false;
  const revs = allRevisions();

  if (page !== app.currentPage) {
    // This call IS the version decision, so the landing must not overrule it
    // with whatever Newest would have picked.
    await goToPage(page, { version: String(revId || '') });
    return true;
  }

  const want = String(revId || '');
  if (!want) {
    if (clearVersion() && announce) {
      const n = (app.project.measurements[page] || [])
        .filter(m => !m.group_child && !m.rev_id).length;
      setStatus(n
        ? `Back on this sheet's own drawing — ${n} item${n === 1 ? '' : 's'} here`
        : "Back on this sheet's own drawing — nothing taken off it yet");
    }
    return true;
  }

  const hit = sheetVersions(page, revs, sheetOrigin()).find(v => v.revId === want);
  if (!hit) {
    setStatus('That revision no longer has a page for this sheet.');
    return false;
  }
  if (flip && versionView.revId === want && versionView.revPage === hit.revPage) {
    return showSheetVersion(page, '', { announce });      // the same one again
  }

  const ticket = ++versionTicket;
  const set = hit.rev._setIndex;
  if (!app.pages.hasRevisionPage(set, hit.revPage)) {
    setStatus('This file does not carry an image for that revision sheet.');
    return false;
  }

  let bmp;
  try {
    bmp = await app.pages.getRevisionPage(set, hit.revPage);
  } catch (err) {
    if (ticket === versionTicket) {
      setStatus(`Could not open that revision sheet — ${err.message}`);
    }
    return false;
  }
  if (ticket !== versionTicket) return false;            // the user moved on

  versionView.revId = want;
  versionView.revPage = hit.revPage;
  versionView.set = set;
  versionView.bitmap = bmp;
  versionView.size = { width: bmp.width, height: bmp.height };
  app.pages.lruSize = MAIN_LRU_COMPARING;
  controller.cancel();
  syncVersionUi();
  requestDraw();

  if (announce) {
    const lbl = revPageLabel(hit.rev, hit.revPage);
    const where = `${hit.label}${hit.date ? ` (${hit.date})` : ''}`;
    const sheetSize = pageImage
      ? { width: pageImage.width, height: pageImage.height } : null;
    setStatus(`Showing ${where}${lbl ? ` — sheet ${lbl}` : ''}. `
      + (sizesMatch(sheetSize, versionView.size)
        ? 'Click the same version again to flip back.'
        : sizeRefusal(sheetSize, versionView.size)));
  }
  return true;
}

/** Land on a sheet showing ITS OWN drawing, whatever Newest says. */
function goToPageOwnVersion(index) {
  return goToPage(index, { version: '' });
}

/**
 * The previous or next SHEET, staying on the same version where that sheet
 * has one.
 *
 * Paging through a set while comparing a revision should keep comparing that
 * revision, not drop back to the original on every sheet it did not reissue.
 */
function stepSheet(delta) {
  const next = app.currentPage + delta;
  if (!(next >= 0 && next < app.pages.pageCount)) return;
  // Every sheet opens on its newest drawing, this one included. Carrying the
  // revision across the set was what the old "stay on this revision" mode
  // wanted; now that looking at an old sheet is a deliberate act on ONE sheet,
  // carrying it would quietly make the next four sheets old as well.
  return goToPage(next);
}

/** The previous or next version of the sheet in view. */
function stepSheetVersion(delta) {
  const vers = versionsOf(app.currentPage);
  if (vers.length < 2) { setStatus('This sheet has only one version'); return; }
  const i = Math.max(0, vers.findIndex(v => v.revId === versionView.revId));
  const j = Math.max(0, Math.min(vers.length - 1, i + delta));
  if (j === i) {
    setStatus(delta > 0
      ? 'Already on the newest drawing of this sheet'
      : 'This is the oldest drawing of this sheet');
    return;
  }
  showSheetVersion(app.currentPage, vers[j].revId);
}

/**
 * Slide a card in the sheets list to walk that sheet's drawings.
 *
 * Right is forward in time, left is back — the direction the drawing moves,
 * not the direction the stack does. A card for a sheet that was never
 * reissued says so rather than doing nothing, because "nothing happened" and
 * "there is nothing to happen" look identical from the other side of a swipe.
 */
async function slideSheetVersion(index, step) {
  if (!(index >= 0 && index < app.pages.pageCount)) return;
  const vers = versionsOf(index);
  if (vers.length < 2) {
    setStatus(`${pageFinalLabel(index)} has only one drawing — nothing to slide to`);
    return;
  }
  if (index !== app.currentPage) await goToPage(index);
  // Two quick slides on different cards both resume here, and the second
  // navigation can land between this one's await and its step — which would
  // step a sheet the user never touched.
  if (index !== app.currentPage) return;
  stepSheetVersion(step);
}

/**
 * A revision page paired with no sheet in this project.
 *
 * It is not a VERSION of anything, so it must not go over a sheet: put over
 * whatever happened to be up, work traced on it would be filed under a drawing
 * it has nothing to do with. It opens on its own instead.
 */
async function showLoosePage(rev, revPage) {
  if (!app.pages.hasRevisionPage(rev._setIndex, revPage)) return;
  showProgress('Opening revision sheet…', 0, 1, '');
  let bmp = null;
  try {
    bmp = await app.pages.getRevisionPage(rev._setIndex, revPage);
  } catch (err) {
    await D.alertDialog('Could not open', err.message);
    return;
  } finally {
    hideProgress();
  }
  const name = (rev.description || '').trim() || (rev.date || 'Revision');
  const lbl = revPageLabel(rev, revPage) || `page ${revPage + 1}`;
  await showImageViewer(bmp, `${name} — ${lbl}`,
    'This page is not paired with any sheet in this project, so it opens on '
    + 'its own. Pair it in the desktop app to take off on it.');
}

/**
 * One picture, on its own, that you can zoom and pan.
 *
 * Used for the diff and for a revision page paired with no sheet. It is its
 * own canvas rather than the main one because neither of those things IS a
 * sheet of this project — putting either on the main canvas would invite
 * drawing on it, and what was drawn would be filed against a real sheet.
 */
function showImageViewer(bmp, title, legend = '') {
  return D.showDialog(close => {
    const d = D.el('div', 'dlg wide imgview');
    d.appendChild(D.el('div', 'dlg-head', title));
    if (legend) d.appendChild(D.el('div', 'imgview-legend', legend));

    const wrap = D.el('div', 'imgview-body');
    const cv = document.createElement('canvas');
    cv.className = 'imgview-canvas';
    wrap.appendChild(cv);
    d.appendChild(wrap);

    const foot = D.el('div', 'dlg-foot');
    const hint = D.el('span', 'imgview-hint', 'scroll to zoom · drag to pan');
    foot.appendChild(hint);
    const ok = D.el('button', 'btn primary', 'Close');
    ok.addEventListener('click', () => close(null));
    foot.appendChild(ok);
    d.appendChild(foot);

    const src = bmp.bitmap || bmp;
    let zoom = 1;
    let ox = 0;
    let oy = 0;
    let fitted = false;

    const paint = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!r.width || !r.height) return;
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#101010';
      ctx.fillRect(0, 0, r.width, r.height);
      if (!fitted) {
        zoom = Math.min(r.width / src.width, r.height / src.height);
        ox = (r.width - src.width * zoom) / 2;
        oy = (r.height - src.height * zoom) / 2;
        fitted = true;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, ox, oy, src.width * zoom, src.height * zoom);
    };

    wrap.addEventListener('wheel', ev => {
      ev.preventDefault();
      const r = wrap.getBoundingClientRect();
      const mx = ev.clientX - r.left;
      const my = ev.clientY - r.top;
      const k = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      // Zoom about the pointer, so what is under it stays under it.
      ox = mx - (mx - ox) * k;
      oy = my - (my - oy) * k;
      zoom *= k;
      paint();
    }, { passive: false });

    let drag = null;
    wrap.addEventListener('pointerdown', ev => {
      drag = { x: ev.clientX, y: ev.clientY };
      wrap.setPointerCapture(ev.pointerId);
    });
    wrap.addEventListener('pointermove', ev => {
      if (!drag) return;
      ox += ev.clientX - drag.x;
      oy += ev.clientY - drag.y;
      drag = { x: ev.clientX, y: ev.clientY };
      paint();
    });
    const stop = () => { drag = null; };
    wrap.addEventListener('pointerup', stop);
    wrap.addEventListener('pointercancel', stop);

    // The dialog has no size until it is in the document, so the first paint
    // has to wait — but it must not wait on requestAnimationFrame ALONE. A
    // hidden or backgrounded tab runs no rAF at all, and this window opens
    // from a click that may well be the last thing before the estimator
    // switches away; it would come back to a blank rectangle. So: a rAF, a
    // timeout, and a ResizeObserver, whichever arrives first. `paint` is
    // idempotent and early-returns while the box is still unsized.
    //
    // The observer is parked on the node deliberately. A ResizeObserver with
    // no strong reference is collectable, and the symptom of losing it is
    // exactly this: a canvas that never gets its size.
    requestAnimationFrame(paint);
    setTimeout(paint, 0);
    setTimeout(paint, 120);
    d._ro = new ResizeObserver(paint);
    d._ro.observe(wrap);
    return d;
  });
}

/* ── comparing two versions ───────────────────────────────────────────────
 *
 * Three ways, because they answer different questions:
 *
 *   FLIP     show the revision in place of the sheet, click again to come
 *            back. The eye catches what moved between two identical frames
 *            better than it catches anything in a static picture.
 *   OVERLAY  the revision drawn in red ON the sheet, at an opacity you
 *            choose, nudgeable if the scan is off-register, and blinkable.
 *   DIFF     one picture: the original's lines blue, the revision's red,
 *            unchanged linework dark. Nothing to hold in your head.
 *
 * The overlay is TRANSIENT here. The desktop persists it per sheet in
 * metadata["page_overlays"]; this build deliberately does not write that key,
 * so looking at a revision cannot change the file — which is the whole
 * contract of this feature, and what keeps a save byte-identical.
 */

const overlay = {
  revId: '', revPage: null,
  bitmap: null,        // the NEWER drawing, as ink
  older: null,         // the OLDER drawing, as ink
  // −1 … 0 … +1. Centre shows both; the ends leave one drawing on the page.
  balance: 0,
  dx: 0, dy: 0,
  align: false,        // dragging moves the overlay instead of panning
  flashOn: true,       // the blink state
  flashTimer: 0,
};

// The two drawings, and the paper they are laid on.
//
// Red for the newest and blue for the older is the vocabulary the slip-sheet
// Diff already uses in this app, so the two tools read the same way round.
// The paper is painted by us rather than inherited from the background,
// which is what makes this legible whatever `background_color` is set to —
// a white plan on a dark app, or a dark app made light.
const INK_NEW = [214, 40, 40];
const INK_OLD = [30, 95, 190];
const COMPARE_PAPER = '#ffffff';

/**
 * How strongly each drawing is painted, from the slider.
 *
 * Centre is both at full: the comparison is a comparison, and halving both
 * would only make two faint drawings instead of two clear ones. Moving off
 * centre fades the far one out and leaves the near one alone.
 */
function compareAlphas() {
  const b = Math.max(-1, Math.min(1, overlay.balance || 0));
  return {
    older: b <= 0 ? 1 : Math.max(0, 1 - b),
    newer: b >= 0 ? 1 : Math.max(0, 1 + b),
  };
}

/** The overlay as the renderer wants it, or null. */
function overlayFrame() {
  if (!overlay.bitmap || !overlay.flashOn) return null;
  const a = compareAlphas();
  return {
    image: overlay.bitmap, alpha: a.newer,
    older: overlay.older, olderAlpha: a.older,
    paper: COMPARE_PAPER,
    dx: overlay.dx, dy: overlay.dy, outline: overlay.align,
  };
}

function overlayActive() { return !!overlay.bitmap; }

function clearOverlay({ draw = true } = {}) {
  if (overlay.flashTimer) { clearInterval(overlay.flashTimer); overlay.flashTimer = 0; }
  overlay.bitmap?.close?.();
  overlay.older?.close?.();
  overlay.revId = ''; overlay.revPage = null;
  overlay.bitmap = null; overlay.older = null;
  overlay.balance = 0;
  overlay.dx = 0; overlay.dy = 0;
  overlay.align = false; overlay.flashOn = true;
  // Align hands the controller a closure that takes over every left-button
  // and middle-button drag. Left behind, it keeps taking them over against an
  // overlay that no longer exists — the drawing simply stops panning, with no
  // error and no way back short of reloading.
  controller.overlayDrag = null;
  $('overlayBar').hidden = true;
  $('ovAlign')?.classList.remove('on');
  $('ovFlash')?.classList.remove('on');
  if (draw) { syncVersionUi(); requestDraw(); }
}

/**
 * Lay the version on screen over the sheet's own drawing, in red.
 *
 * The sheet's OWN drawing has to be underneath — laid over the newest
 * revision it would sit on the same lines and read as "nothing changed".
 */
async function startOverlay() {
  const page = app.currentPage;
  // Compare the sheet's own drawing against the NEWEST reissue of it, whichever
  // of the two happens to be on screen. Insisting the revision be up first was
  // right when the original was the default; now that the newest is, sliding
  // back to the original to look at it would have refused the comparison on the
  // one sheet the user had just said they were interested in.
  let revId = versionView.revId;
  let revPage = versionView.revPage;
  let set = versionView.set;
  if (!revId) {
    const newest = newestOf(page);
    const v = newest
      && versionsOf(page).find(x => x.revId === newest);
    if (!v) {
      setStatus('This sheet has only one drawing — there is nothing to compare it with.');
      return;
    }
    // sheetVersions hands back the revision OBJECT; the set index lives on it.
    revId = v.revId; revPage = v.revPage; set = v.rev._setIndex;
  }
  showProgress('Preparing the comparison…', 0, 1, '');
  let inkNew = null;
  let inkOld = null;
  try {
    const bmp = await app.pages.getRevisionPage(set, revPage);
    inkNew = await tintLinework(bmp, INK_NEW);
    // The sheet's OWN drawing is the other half of the comparison, and it has
    // to become ink too. Left as a raster its white paper would cover the
    // revision's lines wherever the two differ — which is precisely and only
    // the places worth looking at.
    const own = await app.pages.getPage(page);
    inkOld = await tintLinework(own, INK_OLD);
  } catch (err) {
    inkNew?.close?.();
    inkOld?.close?.();
    await D.alertDialog('Could not build the comparison', err.message);
    return;
  } finally {
    hideProgress();
  }
  clearOverlay({ draw: false });
  overlay.revId = revId;
  overlay.revPage = revPage;
  overlay.bitmap = inkNew;
  overlay.older = inkOld;
  overlay.balance = Number($('ovBalance').value) / 100;
  // The version on screen is deliberately NOT changed.
  //
  // This used to flip back to the sheet's own drawing so the revision had
  // something to sit on. The comparison paints both drawings itself now, so
  // the flip bought nothing — and it cost a great deal: it left the sheet
  // standing on its superseded drawing, which marked it OLD, raised the badge
  // and made it read-only, for the crime of comparing. Comparing is looking at
  // both; it is not being on the old one.
  $('overlayBar').hidden = false;
  // Bring the stack down with it. A bar whose whole purpose is a slider the
  // user is about to drag must not arrive hidden above the top of the window.
  openChrome();
  $('ovWhat').textContent = revisionLabel(revId, allRevisions());
  syncCompareLabel();
  syncVersionUi();
  requestDraw();
  setStatus('Comparing: older in blue, newest in red. Slide towards the one '
    + 'you want to see more of — the centre shows both.');
}

/**
 * A copy of a drawing where the paper is transparent and the lines are one
 * flat colour.
 *
 * This is what the desktop's GL_MODULATE overlay does: the texture is white
 * with `alpha = 1 − luminance`, tinted by glColor. Drawn with plain
 * source-over at the user's alpha it lands pixel for pixel on the same result.
 *
 * Built once per overlay and cached, because it is a full-sheet pass: on a
 * 6300×4500 sheet that is 28 million pixels, ~150 ms. Doing it per frame would
 * make Flash unusable.
 */
async function tintLinework(bmp, [r, g, b]) {
  const src = bmp.bitmap || bmp;                  // a ReducedPage wraps one
  const w = src.width;                            // the DECODED size
  const h = src.height;
  // ...and the size the sheet really is. On iOS a big sheet is decoded
  // reduced into a ReducedPage that still reports its native dimensions, and
  // everything downstream — the paper plate, the align offset, the page
  // coordinates — is in native pixels. Returning a bare bitmap measured in
  // decoded pixels drew the whole comparison at a fraction of its size in the
  // corner of a full-size white plate.
  const nativeW = bmp.width || w;
  const nativeH = bmp.height || h;
  const cv = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // ITU-R 601-2 luma, the same weights PIL's convert("L") uses, so the
    // result matches the desktop's texture rather than merely resembling it.
    const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
    d[i + 3] = 255 - lum;
  }
  ctx.putImageData(img, 0, 0);
  const bitmap = await createImageBitmap(cv);
  // The same shape ReducedPage has: the renderer already draws `bitmap` to an
  // explicit destination size taken from `width`/`height`.
  return {
    bitmap,
    width: nativeW,
    height: nativeH,
    close() { this.bitmap?.close?.(); },
  };
}

function toggleOverlayAlign() {
  if (!overlayActive()) return;
  overlay.align = !overlay.align;
  $('ovAlign').classList.toggle('on', overlay.align);
  controller.overlayDrag = overlay.align
    ? (dxPage, dyPage) => { overlay.dx += dxPage; overlay.dy += dyPage; requestDraw(); }
    : null;
  setStatus(overlay.align
    ? 'Align: drag the drawing to move the red overlay into register. '
      + 'Click Align again when it lines up.'
    : 'Align off.');
  requestDraw();
}

function toggleOverlayFlash() {
  if (!overlayActive()) return;
  if (overlay.flashTimer) {
    clearInterval(overlay.flashTimer);
    overlay.flashTimer = 0;
    overlay.flashOn = true;
    $('ovFlash').classList.remove('on');
  } else {
    overlay.flashTimer = setInterval(() => {
      overlay.flashOn = !overlay.flashOn;
      requestDraw();
    }, 600);
    $('ovFlash').classList.add('on');
  }
  requestDraw();
}

/**
 * The two-colour slip-sheet diff.
 *
 * Original lines BLUE, revision lines RED, unchanged linework dark, paper
 * white. Exactly the desktop's `_compose_diff_image`: each sheet is colourised
 * from its grey level — black→the colour, white→white — and the two are
 * MULTIPLIED. Where both are dark the product is near-black; where only one
 * is, its own colour survives; where neither is, white.
 *
 * There is no threshold and no auto-alignment, deliberately: either would
 * change what a plan-checker is shown. The only offset is the one dragged in
 * Align, and only for the revision that is actually overlaid.
 */
async function diffCurrentVersion() {
  const revId = versionView.revId || overlay.revId;
  const revPage = versionView.revId ? versionView.revPage : overlay.revPage;
  if (!revId) {
    setStatus('Put a revision of this sheet on screen first, then Diff it '
      + 'against the original.');
    return;
  }
  const page = app.currentPage;
  const rev = allRevisions().find(r => String(r.id) === String(revId));
  if (!rev) return;

  showProgress('Building the diff…', 0, 1, '');
  let out = null;
  try {
    const own = await app.pages.getPage(page);
    const other = await app.pages.getRevisionPage(rev._setIndex, revPage);
    const off = (overlay.revId === revId && overlay.revPage === revPage)
      ? { dx: Math.round(overlay.dx), dy: Math.round(overlay.dy) }
      : { dx: 0, dy: 0 };
    out = await composeDiff(own, other, off);
  } catch (err) {
    await D.alertDialog('Could not build the diff', err.message);
    return;
  } finally {
    hideProgress();
  }
  if (!out) return;
  await showImageViewer(out,
    `Diff — sheet ${pageFinalLabel(page)}`,
    `RED = ${revisionLabel(revId, allRevisions())}   ·   `
    + 'BLUE = this project’s own drawing   ·   DARK = unchanged');
}

/**
 * Compose the slip-sheet diff on a canvas.
 *
 * The canvas is GROWN to fit a negative offset before anything is drawn
 * (`ox = max(-dx, 0)`), or a revision nudged up and left is clipped off the
 * top — and a real change then disappears instead of showing.
 *
 * Both sheets are routed through the browser's canvas cap first. Past about
 * 16.8 megapixels a canvas does not throw: it returns transparent black. A
 * full-resolution diff of two 28-megapixel sheets would render BLANK on an
 * iPad, and blank reads as "nothing changed" — the most dangerous wrong
 * answer this feature could give.
 */
async function composeDiff(oldImg, newImg, { dx = 0, dy = 0 } = {}) {
  const a = oldImg.bitmap || oldImg;
  const b = newImg.bitmap || newImg;
  const w = Math.max(a.width, b.width + Math.max(dx, 0)) + Math.max(-dx, 0);
  const h = Math.max(a.height, b.height + Math.max(dy, 0)) + Math.max(-dy, 0);
  const ox = Math.max(-dx, 0);
  const oy = Math.max(-dy, 0);

  const { canvasLimits, fitFactor } = await import('./core/canvas-limits.js');
  const limits = await canvasLimits();
  const k = Math.min(1, fitFactor(w, h, limits));
  const cw = Math.max(1, Math.floor(w * k));
  const ch = Math.max(1, Math.floor(h * k));

  const make = () => (typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(cw, ch)
    : Object.assign(document.createElement('canvas'), { width: cw, height: ch }));

  // Each layer: white paper, the sheet drawn grey, then colourised. `screen`
  // with a flat colour IS PIL's colorize(black=c, white=white) — for a grey v,
  // both give c + v·(255−c)/255.
  const layer = (img, sx, sy, colour) => {
    const cv = make();
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.filter = 'grayscale(1)';
    ctx.drawImage(img, sx * k, sy * k, img.width * k, img.height * k);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, cw, ch);
    return cv;
  };

  const blue = layer(a, ox, oy, 'rgb(50,90,220)');
  const red = layer(b, ox + dx, oy + dy, 'rgb(225,45,45)');

  const out = make();
  const ctx = out.getContext('2d');
  ctx.drawImage(blue, 0, 0);
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(red, 0, 0);
  const bmp = await createImageBitmap(out);
  // A canvas over the cap comes back transparent rather than failing, so check
  // rather than trust: a blank diff would read as "nothing changed".
  if (!bmp || !bmp.width) throw new Error('This device could not build an image that large.');
  return bmp;
}

/** Frame the current sheet. Returns false if the canvas has no size yet. */
function applyDefaultZoom() {
  if (!pageImage) return false;
  viewport.resize();
  if (!viewport.measured) return false;
  const rect = { x: 0, y: 0, w: pageImage.width, h: pageImage.height };
  const mode = app.settings.get('default_zoom_mode');
  if (mode === '100') {
    viewport.zoom = 1;
    viewport.centerOn(rect.w / 2, rect.h / 2);
    return true;
  }
  return mode === 'width' ? viewport.fitWidth(rect) : viewport.fit(rect);
}

function applyDefaultZoomTo(mode) {
  if (!pageImage) return false;
  viewport.resize();
  if (!viewport.measured) return false;
  const rect = { x: 0, y: 0, w: pageImage.width, h: pageImage.height };
  return mode === 'width' ? viewport.fitWidth(rect) : viewport.fit(rect);
}

function pageFinalLabel(idx) {
  if (idx === STANDALONE_PAGE) return 'no sheet';
  return app.project.pageLabel(idx);
}

function syncPageOf() {
  $('pageOf').textContent = app.pages.pageCount
    ? `${pageFinalLabel(app.currentPage)}  ·  ${app.currentPage + 1} / ${app.pages.pageCount}`
    : '';
  syncMobileBar();
}

/* ══════════════════════════════════════════════════════════════════════
   Phones and tablets

   Below 1024px the two side panels are drawers that slide over the sheet
   instead of columns beside it, and a bar at the foot of the screen carries
   the handful of things that must never be more than one tap away — the two
   drawers, the two page arrows, Fit — because the toolbars scroll sideways
   on a narrow screen and anything can be off the edge.

   While a chain tool is collecting points the bar swaps to Finish / Undo
   point / Cancel. That is not a convenience: a polyline finishes on a
   double-click or Enter, and a tablet has neither, so before this there was
   no way to close one at all.

   Everything here is behind one matchMedia. The desktop layout is untouched.
   ══════════════════════════════════════════════════════════════════════ */

/* ── touch layout or standard layout ───────────────────────────────────
 *
 * Touch is the default, on every device, because that is what was asked
 * for; standard is one click away and is remembered. Live, not on reload:
 * everything that sizes the chrome reads a CSS custom property, and the two
 * things that size the DRAWING are read fresh every frame in drawFrame.
 */
function uiMode() { return resolveUiMode(app.settings.values); }

function setUiMode(mode, { announce = true } = {}) {
  const next = mode === 'standard' ? 'standard' : 'touch';
  document.documentElement.dataset.ui = next;
  app.settings.set('ui_mode', next);
  // Kept in step so a stale main.js served from cache cannot disagree with
  // the stylesheet. Nothing new reads it.
  app.settings.set('ui_touch_mode', next === 'touch');
  syncUiModeMenu();
  // The canvas box changed underneath the viewport.
  requestDraw();
  if (announce) {
    setStatus(next === 'touch'
      ? 'Touch layout — bigger targets, made for a finger.'
      : 'Standard layout — the desktop proportions.');
  }
}

function syncUiModeMenu() {
  const m = uiMode();
  const t = document.getElementById('uiTouchItem');
  const d = document.getElementById('uiStandardItem');
  if (t) t.textContent = m === 'touch' ? '✓  Touch layout' : 'Touch layout';
  if (d) d.textContent = m === 'standard' ? '✓  Standard layout' : 'Standard layout';
}

const MOBILE_Q = window.matchMedia('(max-width: 1023px)');
const isMobileLayout = () => MOBILE_Q.matches;

function closeDrawers() {
  $('thumbsPanel').classList.remove('mopen');
  $('itemsPanel').classList.remove('mopen');
  $('scrim').hidden = true;
}

function toggleDrawer(which) {
  const el = which === 'thumbs' ? $('thumbsPanel') : $('itemsPanel');
  const other = which === 'thumbs' ? $('itemsPanel') : $('thumbsPanel');
  const open = !el.classList.contains('mopen');
  other.classList.remove('mopen');
  el.classList.toggle('mopen', open);
  $('scrim').hidden = !open;
}

// 'changed' fires on every pointermove of a pan, so the bar only writes to
// the DOM when something it shows has actually moved.
let _mbarWas = null;
function syncMobileBar() {
  const on = isMobileLayout();
  const chain = on && controller.chainLive;
  const label = app.pages.pageCount
    ? `${app.currentPage + 1}/${app.pages.pageCount}`
    : 'Fit';
  const key = `${on}|${chain}|${label}`;
  if (key === _mbarWas) return;
  _mbarWas = key;
  $('mobileBar').hidden = !on;
  $('mbarMain').hidden = chain;
  $('mbarChain').hidden = !chain;
  $('mbarPage').textContent = label;
  if (!on) closeDrawers();
}

// ── scale ─────────────────────────────────────────────────────────────────

function buildScaleSelect() {
  const sel = $('scaleSelect');
  sel.textContent = '';
  const dpi = app.project.dpi;
  const seen = new Set();
  for (const [label, inches, feet] of EXTENDED_SCALES) {
    const ppf = computePixelsPerFoot(dpi, inches, feet);
    const key = ppf.toFixed(3);
    if (seen.has(key)) continue;
    seen.add(key);
    const o = document.createElement('option');
    o.value = String(ppf);
    o.textContent = label;
    sel.appendChild(o);
  }
  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom…';
  sel.appendChild(custom);
}

function syncScaleSelect() {
  const sel = $('scaleSelect');
  const ppf = app.project.pagePpf(app.currentPage);
  const label = app.project.pageScaleLabel(app.currentPage);
  // A calibrated sheet has no preset to select, so show its px/ft figure as a
  // one-off option rather than silently displaying somebody else's scale.
  let calOpt = sel.querySelector('option[data-calibrated]');
  if (label.endsWith('px/ft')) {
    if (!calOpt) {
      calOpt = document.createElement('option');
      calOpt.dataset.calibrated = '1';
      sel.insertBefore(calOpt, sel.firstChild);
    }
    calOpt.value = String(ppf);
    calOpt.textContent = `${label} (calibrated)`;
  } else if (calOpt) {
    calOpt.remove();
  }
  const match = [...sel.options].find(o => Math.abs(Number(o.value) - ppf) < 0.01);
  sel.value = match ? match.value : String(ppf);
  $('scaleReadout').textContent = app.pages.pageCount
    ? `Scale ${label}   ·   ${ppf.toFixed(2)} px/ft`
    : '';
}

$('scaleSelect').addEventListener('change', async ev => {
  const sel = ev.target;
  let ppf;
  if (sel.value === 'custom') {
    const txt = await D.promptDialog('Custom Scale', 'Pixels per foot',
      String(app.project.pagePpf(app.currentPage).toFixed(2)),
      `At ${app.project.dpi} DPI, 1/4" = 1 ft is ${computePixelsPerFoot(app.project.dpi, 0.25, 1).toFixed(1)} px/ft.`);
    ppf = Number(txt);
    if (!(ppf > 0)) { syncScaleSelect(); return; }
  } else {
    ppf = Number(sel.value);
  }
  await setSheetScale(ppf);
});

/**
 * Restate the current sheet's scale.
 *
 * Work already drawn keeps the scale it was drawn at, and the user is told so
 * — and offered the destructive alternative explicitly. Silently re-valuing a
 * sheet full of measurements is how a 320 LF wall becomes 160 LF inside a bid
 * with nobody watching.
 */
async function setSheetScale(ppf) {
  const existing = (app.project.measurements[app.currentPage] || [])
    // A pitch is an angle, not a length, and a reference distance is not at
    // this sheet's scale and will not be re-valued with it (KEEPS_OWN_SCALE).
    // Counting either one would offer to re-value work that no answer here
    // touches.
    .filter(m => m.type !== 'pitch' && !KEEPS_OWN_SCALE.has(m.type)
      && (m.points || []).length);
  if (existing.length) {
    const answer = await D.showDialog(close => {
      const body = D.el('div');
      body.style.cssText = 'font-size:12.5px;line-height:1.65';
      body.textContent =
        `This sheet already carries ${existing.length} measurement${existing.length === 1 ? '' : 's'}, ` +
        `each recorded at the scale it was drawn at.\n\n` +
        `Keep them as they are, and draw everything from now on at the new scale? ` +
        `Or re-value every one of them to the new scale?`;
      body.style.whiteSpace = 'pre-line';
      return D.dlg({
        title: 'Change sheet scale',
        body,
        buttons: [
          D.button('Cancel', '', () => close(null)),
          D.button('Re-value everything', 'danger', () => close('restamp')),
          D.button('Keep existing work', 'primary', () => close('keep')),
        ],
      });
    });
    if (!answer) { syncScaleSelect(); return; }
    if (answer === 'restamp') app.project.restampPage(app.currentPage, ppf);
    else app.project.setPageScale(app.currentPage, ppf);
  } else {
    app.project.setPageScale(app.currentPage, ppf);
  }
  syncScaleSelect();
  setStatus(`Sheet scale set to ${app.project.pageScaleLabel(app.currentPage)}`);
}

// ── toolbar ───────────────────────────────────────────────────────────────

function buildToolButtons() {
  fillToolRow($('toolButtons'), TAKEOFF_TOOLS);
  fillToolRow($('viewToolButtons'), VIEW_TOOLS, {
    // The same three tools, said in the words that are true here: these read
    // a drawing, they do not take off from it.
    labels: { distance: 'Measure', area: 'Area', pitch: 'Pitch' },
    hint: 'Temporary — not saved with the project.',
  });
  fillToolRow($('markupButtons'), MARKUP_TOOLS);
  buildMarkupStyleControls();
}

function fillToolRow(wrap, tools, { labels = null, hint = '' } = {}) {
  wrap.textContent = '';
  for (const [mode, label] of tools) {
    const b = document.createElement('button');
    b.className = `tool-btn${mode === 'pan' ? ' on' : ''}`;
    b.dataset.mode = mode;
    b.textContent = (labels && labels[mode]) || label;
    b.title = (HINTS[mode] || label) + (hint && mode !== 'pan' ? `\n\n${hint}` : '');
    b.addEventListener('click', () => controller.setMode(mode));
    wrap.appendChild(b);
  }
}

/**
 * The markup colour and width controls.
 *
 * Highlighter and pen keep SEPARATE colours and widths, as they do on the
 * desktop: a 14 px yellow wash and a 3 px red line are different instruments,
 * and making them share a setting means every switch costs two adjustments.
 */
function buildMarkupStyleControls() {
  const style = controller.markupStyle;

  const fill = (wrap, colors, key) => {
    wrap.textContent = '';
    for (const [name, c] of colors) {
      const b = document.createElement('button');
      b.className = 'swatch-btn';
      b.title = `${name} ${key === 'highlightColor' ? 'highlight' : 'pen'}`;
      b.style.background = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${key === 'highlightColor' ? 0.78 : 1})`;
      b.classList.toggle('on', sameColor(style[key], c));
      b.addEventListener('click', () => {
        style[key] = c.slice();
        // Picking a colour picks the instrument too — nobody chooses a
        // highlighter colour meaning to keep drawing with the pen.
        controller.setMode(key === 'highlightColor' ? 'highlight' : 'draw');
        buildMarkupStyleControls();
      });
      wrap.appendChild(b);
    }
  };
  fill($('highlightColors'), HIGHLIGHT_COLORS, 'highlightColor');
  fill($('penColors'), PEN_COLORS, 'penColor');
  syncMarkupWidth();
}

function sameColor(a, b) {
  return a && b && Math.abs(a[0] - b[0]) < 0.02
    && Math.abs(a[1] - b[1]) < 0.02 && Math.abs(a[2] - b[2]) < 0.02;
}

/** The width slider follows whichever instrument is live. */
function syncMarkupWidth() {
  const style = controller.markupStyle;
  const pen = controller.mode === 'draw';
  const el = $('markupWidth');
  el.value = String(pen ? style.penWidth : style.highlightWidth);
  $('markupWidthOut').textContent = el.value;
}

$('markupWidth').addEventListener('input', () => {
  const v = Math.max(1, Number($('markupWidth').value) || 1);
  if (controller.mode === 'draw') controller.markupStyle.penWidth = v;
  else controller.markupStyle.highlightWidth = v;
  $('markupWidthOut').textContent = String(v);
});

// ── the revision bars' own controls ──────────────────────────────────────
// (every plain button in them carries data-act and is dispatched already)

$('ovBalance').addEventListener('input', () => {
  overlay.balance = Math.max(-1, Math.min(1, (Number($('ovBalance').value) || 0) / 100));
  syncCompareLabel();
  requestDraw();
});

// Double-click the slider to put it back in the middle. A balance control is
// worth being able to re-centre exactly, and dragging to 0 by hand is fiddly.
$('ovBalance').addEventListener('dblclick', () => {
  $('ovBalance').value = '0';
  overlay.balance = 0;
  syncCompareLabel();
  requestDraw();
});

/** What the slider is saying, in words. */
function syncCompareLabel() {
  const out = $('ovBalanceOut');
  if (!out) return;
  const b = overlay.balance || 0;
  const pct = Math.round(Math.abs(b) * 100);
  out.textContent = pct < 3 ? 'both'
    : b > 0 ? `newest +${pct}%`
      : `older +${pct}%`;
}

/* ══════════════════════════════════════════════════════════════════════
   The toolbars, and getting them out of the way

   Five bars stack above the drawing and four of them are wanted a moment at a
   time. Unpinned they are taken out of the layout — see the CSS, where the
   whole stack goes `position:absolute` so its grid row collapses WITHOUT
   being hidden; hiding a grid row is what used to slide the body into a row
   that measured nothing and take the drawing with it.

   Reaching for them is deliberately dumb: the pointer at the very top of the
   window, or a pull down from the top edge. Both are what a person tries
   first, and neither needs to be taught.
   ══════════════════════════════════════════════════════════════════════ */

const appEl = $('app');
let chromeOpen = false;
let chromeHold = 0;          // close timer, so a brush past does not slam it

function chromePinned() { return !!app.settings.get('chrome_pinned'); }

function syncChrome() {
  const pinned = chromePinned();
  appEl.classList.toggle('chrome-float', !pinned);
  appEl.classList.toggle('chrome-open', !pinned && chromeOpen);
  $('chromePin')?.classList.toggle('on', pinned);
  const item = $('chromePinItem');
  if (item) item.textContent = pinned ? '✓ Pin Toolbars' : 'Pin Toolbars';
  const pin = $('chromePin');
  if (pin) {
    pin.title = pinned
      ? 'Toolbars are pinned — click to let them slide away (M)'
      : 'Toolbars slide away — click to keep them on screen (M)';
  }
  // The options bar hangs off a toolbar button. With the stack away there is
  // nothing to hang from, so it parks against the top of the sheet instead.
  placeToolOptions(controller.mode);
}

function openChrome() {
  clearTimeout(chromeHold);
  if (chromePinned() || chromeOpen) return;
  chromeOpen = true;
  syncChrome();
}

function closeChrome({ delay = 0 } = {}) {
  clearTimeout(chromeHold);
  if (chromePinned() || !chromeOpen) return;
  const go = () => { chromeOpen = false; syncChrome(); };
  if (delay) chromeHold = setTimeout(go, delay);
  else go();
}

function setChromePinned(on) {
  app.settings.set('chrome_pinned', !!on);
  chromeOpen = false;
  syncChrome();
  setStatus(on
    ? 'Toolbars pinned'
    : 'Toolbars hidden — reach the top of the window, or pull down from the top edge');
}

// Reaching the top of the window brings them down; leaving them sends them
// away again, after a moment so that crossing a gap does not close them.
$('chromeEdge').addEventListener('pointerenter', () => openChrome());
$('chromeEdge').addEventListener('pointerdown', ev => {
  // A pull DOWN from the edge, for a tablet, where there is no pointer to
  // hover with. Taken on the edge strip only, so it can never be confused
  // with a pan of the drawing.
  const y0 = ev.clientY;
  const id = ev.pointerId;
  const move = e => {
    if (e.pointerId !== id) return;
    if (e.clientY - y0 > 12) { openChrome(); stop(); }
  };
  const stop = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
});
$('chrome').addEventListener('pointerenter', () => { clearTimeout(chromeHold); });
$('chrome').addEventListener('pointerleave', ev => {
  // Mouse only. A finger lifting fires pointerleave, so on a tablet this
  // closed the stack 420ms after every tap — taking the menu that had just
  // been opened away with it. Touch closes by tapping the sheet, or pinning.
  if (ev.pointerType && ev.pointerType !== 'mouse') return;
  closeChrome({ delay: 420 });
});
// Using anything in the bars keeps them up; the menus in particular open
// POPUPS that sit below the bar, and a close on leave would eat them.
$('chrome').addEventListener('pointerdown', () => clearTimeout(chromeHold));
$('chrome').addEventListener('focusin', () => clearTimeout(chromeHold));
// The options bar is no longer inside #chrome — it has to outlive the slide,
// because it belongs to the tool being used on the drawing. So reaching for it
// has to cancel the close that leaving the stack just started, or it would
// retract while the estimator is in its dropdown.
$('toolOpts').addEventListener('pointerenter', () => clearTimeout(chromeHold));
$('toolOpts').addEventListener('pointerdown', () => clearTimeout(chromeHold));
$('toolOpts').addEventListener('focusin', () => clearTimeout(chromeHold));

// The sheet is what you went back to looking at.
$('stage').addEventListener('pointerdown', () => closeChrome());

// No click listener here on purpose: the button carries data-act="toggle-chrome-pin"
// and the menu dispatcher already runs it. Wiring both fired the toggle twice
// on every press — pin then unpin — so the button did nothing at all.

/** The floating options bar, parked under the button that owns it. */
function syncToolOptions(mode) {
  const bar = $('toolOpts');
  bar.textContent = '';
  const o = controller.options;
  const parts = [];

  // Markup carries no item name — it is not an item. Neither does a temporary
  // dimension: it is not filed anywhere, so there is nothing for a name to be
  // on, and offering the field would suggest it is going to be kept.
  const NO_NAME = new Set([
    'pan', 'window', 'door', 'calibrate', 'pitch',
    ...MARKUP_TOOLS.map(t => t[0]),
  ]);
  if (!NO_NAME.has(mode) && !controller.isScratchTool(mode)) {
    const nameInput = D.input(o.pendingName, 'text');
    nameInput.className = 'tb-input';
    nameInput.placeholder = 'Item name…';
    nameInput.setAttribute('list', 'catalogNames');
    nameInput.addEventListener('input', () => { o.pendingName = nameInput.value; });
    parts.push([mode === 'count' ? 'Counting' : 'Item', nameInput]);
  }

  if (mode === 'linear_count') {
    const sp = D.input(String(o.spacingIn), 'number', { step: '0.25', min: '0.25' });
    sp.className = 'tb-input';
    sp.style.width = '70px';
    sp.addEventListener('input', () => {
      o.spacingIn = Number(sp.value) || 12;
      requestDraw();
    });
    parts.push(['Spacing (in)', sp]);
  }

  if (mode === 'grid') {
    const w = D.input(String(o.gridCellW), 'number', { step: '0.25', min: '0.05' });
    const h = D.input(String(o.gridCellH), 'number', { step: '0.25', min: '0.05' });
    const a = D.input(String(o.gridAngle), 'number', { step: '5' });
    for (const [n, key] of [[w, 'gridCellW'], [h, 'gridCellH'], [a, 'gridAngle']]) {
      n.className = 'tb-input'; n.style.width = '64px';
      n.addEventListener('input', () => { o[key] = Number(n.value) || 0; requestDraw(); });
    }
    parts.push(['Cell (ft)', w], ['×', h], ['Angle°', a]);
  }

  if (mode === 'tile') {
    const sizes = TILE_SIZE_OPTIONS();
    const size = D.select(sizes, `${o.tileWIn}x${o.tileHIn}`);
    size.className = 'tb-select';
    size.addEventListener('change', () => {
      const [tw, th] = size.value.split('x').map(Number);
      o.tileWIn = tw; o.tileHIn = th;
      requestDraw();
    });
    const pat = D.select(TILE_PATTERN_OPTIONS(), o.tilePattern);
    pat.className = 'tb-select';
    pat.addEventListener('change', () => { o.tilePattern = pat.value; requestDraw(); });
    const ang = D.input(String(o.tileAngle), 'number', { step: '5' });
    ang.className = 'tb-input'; ang.style.width = '64px';
    ang.addEventListener('input', () => { o.tileAngle = Number(ang.value) || 0; requestDraw(); });
    parts.push(['Size', size], ['Pattern', pat], ['Angle°', ang]);
  }

  if (!parts.length) { bar.hidden = true; return; }

  for (const [label, node] of parts) {
    bar.appendChild(D.el('span', 'tb-label', label));
    bar.appendChild(node);
  }
  bar.hidden = false;
  placeToolOptions(mode);
}

function TILE_SIZE_OPTIONS() {
  return [[1, 1], [2, 2], [4, 4], [6, 6], [8, 8], [12, 12], [12, 24], [16, 16],
    [18, 18], [20, 20], [24, 24], [6, 36], [8, 48], [12, 48], [24, 48]]
    .map(([w, h]) => [`${w}x${h}`, `${w}″×${h}″`]);
}
function TILE_PATTERN_OPTIONS() {
  return [['grid', 'Straight Grid'], ['half', 'Running Bond 1/2'],
    ['third', 'Stair-Step 1/3'], ['herringbone', 'Herringbone'],
    ['chevron', 'Chevron'], ['diagonal', 'Diagonal 45']];
}

/**
 * Park the options bar under its tool button.
 *
 * It floats over the canvas rather than sitting in the layout, because adding
 * a row to the layout shortened the canvas every time a tool was picked and
 * the drawing jumped under the cursor.
 */
function placeToolOptions(mode) {
  const bar = $('toolOpts');
  // View Only puts its tools in their own row, and a lookup that missed it
  // left the bar parked wherever it last was — over the sheets panel.
  const btn = $('toolButtons').querySelector(`[data-mode="${mode}"]`)
    || $('viewToolButtons').querySelector(`[data-mode="${mode}"]`)
    || $('markupButtons').querySelector(`[data-mode="${mode}"]`);
  if (!btn || bar.hidden) return;
  const br = btn.getBoundingClientRect();
  const ar = document.getElementById('app').getBoundingClientRect();
  const bw = bar.offsetWidth || 260;
  let x = br.left - ar.left;
  x = Math.max(6, Math.min(x, ar.width - bw - 6));
  bar.style.left = `${x}px`;
  // With the stack slid away the button it hangs from is off the top of the
  // window, and following it would park this bar at a negative offset where
  // the tool's own options cannot be reached at all.
  const stageTop = $('stage').getBoundingClientRect().top - ar.top;
  const under = br.bottom - ar.top + 4;
  bar.style.top = `${Math.max(stageTop + 6, under)}px`;
}

window.addEventListener('resize', () => placeToolOptions(controller.mode));

// ── open and save ─────────────────────────────────────────────────────────

/**
 * Whether this browser can write back to a file it opened.
 *
 * Chrome and Edge can; Firefox and Safari cannot, and fall back to an
 * <input type=file> for opening and a download for saving. That fallback is a
 * genuinely different code path with its own rules about user activation, and
 * it broke once without anyone noticing on Chrome — so `?nofsapi` forces it on
 * from any browser, which is how it gets tested.
 */
const canUseFsApi = 'showOpenFilePicker' in window
  && !new URLSearchParams(location.search).has('nofsapi');

/**
 * Where plans come from on this device: 'folder' (the Plans Archive folder)
 * or 'sharepoint' (handed over by the portal). Settings first, then the
 * company's default in js/site-config.js — the line that is the switch.
 */
function plansSource() {
  return resolvePlansSource(app.settings.get('plans_source'), PLANS_SOURCE);
}

// The Plans Archive: plan folders chosen on this device, remembered in
// IndexedDB (a folder handle can be kept there and nowhere else).
const plansStore = new PlansFolders({ backend: idbBackend() });
const plansArchive = new PlansArchive({
  store: plansStore,
  host: {
    mode: () => plansSource(),
    status: text => setStatus(text),
    refreshStart: () => renderArchiveSection(),
    openTakeoff: entry => openArchiveTakeoff(entry),
    startFromPdf: entry => startArchivePdf(entry),
    // A #plans link where no folder can be opened: the plans already on this
    // device, as the start screen lists and opens them, and its open button.
    devicePlans: () => ({ kept: keptEntries(), portal: libraryEntries() }),
    devicePlanRows: (plans, opts) => devicePlanRows(plans, { ...opts, removable: false }),
    // safeRun('open-project') by another door — called inside the tap, no
    // await before the picker — with the panel closed only once a file is
    // chosen (beforeOpen), so Cancel on "Unsaved changes" or on the picker
    // comes back to it.
    openFile: ({ beforeOpen = null } = {}) => {
      openProjectFile({ beforeOpen }).catch(err => reportActionError('open-project', err));
    },
  },
});

/**
 * Open a project.
 *
 * The unsaved-changes prompt is checked SYNCHRONOUSLY first. Awaiting it
 * unconditionally cost the user activation the file picker needs in Firefox,
 * even when there was nothing to confirm — which is every first open.
 *
 * `beforeOpen` runs once a file has been chosen, just before it is opened: a
 * #plans link's panel closes itself there, and stays on screen when the
 * person backs out of the question or the picker.
 */
async function openProjectFile({ beforeOpen = null } = {}) {
  if (app.project.dirty) {
    if (!(await confirmDiscard())) return;
  }
  let file, handle = null;
  if (canUseFsApi) {
    try {
      [handle] = await window.showOpenFilePicker({
        types: [{
          description: 'Takeoff Projects',
          accept: { 'application/octet-stream': [FILE_EXTENSION, LEGACY_EXTENSION] },
        }],
      });
      file = await handle.getFile();
    } catch (err) {
      if (err.name === 'AbortError') return;
      throw err;
    }
  } else {
    file = await pickFileFallback(`${FILE_EXTENSION},${LEGACY_EXTENSION}`);
    if (!file) return;
  }
  if (beforeOpen) beforeOpen();
  await loadProjectFile(file, handle);
}

/**
 * Open any File-like project. Resolves true once it is on screen and false
 * when it could not be opened. A failure has already been shown to the user
 * by then, so the answer is only for adding to a successful open.
 *
 * `library` is given only for a Plans Library copy (see openLibraryCopy): the
 * hold that keeps the portal from deleting that copy while it is open.
 *
 * `archive` is given for a file opened from the Plans Archive folder (see
 * openArchiveTakeoff). A file opened any other way that turns out to sit
 * inside one of this device's plan folders is treated the same, so Save
 * guards it the same way whichever door it came in by.
 */
async function loadProjectFile(file, handle = null, { library = null, archive = null } = {}) {
  showProgress('Opening project…', 0, 1, file.name);
  try {
    // Only the header, the metadata and the page index are read here — about
    // 2 KB even on the 2.3 GB job. Sheets are fetched one at a time as drawn.
    const opened = await openProject(file);
    app.project.loadFrom({
      metadata: opened.metadata,
      annotations: opened.annotations,
      measurements: opened.measurements,
      pageCount: opened.pageCount,
      // How many sheets each revision set holds, out of the tail's INDEX.
      // None of their pixels are read here — on the 2.3 GB job that tail is
      // 1.42 GB, and a revision sheet is fetched only when it is looked at.
      revisionCounts: opened.revisions.map(set => set.length),
    });
    app.pages.setFromProject(opened);
    app.fileHandle = handle;
    app.archive = archive;
    app.saveStartIn = archive ? archive.dir || null : null;
    // The project in hand is this one from here on. A library copy the last
    // one was read from is no longer open, so its lock goes now — not before,
    // because a failed open leaves the last project open and still reading
    // it. A library open brings its own hold, and the save check follows it.
    if (app.libraryCopy && app.libraryCopy !== library) app.libraryCopy.release();
    app.libraryCopy = library;
    app.fileName = file.name;
    app.fileSize = file.size;
    // The bytes as opened, for File > Keep on This Device: a File from the
    // Plans Archive folder or a file picker (a portal link's remote file is
    // not one, and a copy already on this device needs no second copy).
    app.sourceFile = !library && typeof Blob !== 'undefined' && file instanceof Blob ? file : null;
    app.project.filePath = file.name;
    // A new session picks up the palette where the project left off, so a
    // fresh item does not repeat the colour of the last one drawn.
    setPaletteIndex(countItems());
    // Another project's details are not this one's.
    calloutPreview.hide();
    calloutPreview.clearCache();
    hideEmptyState();
    buildScaleSelect();
    // Rebuilt before the thumbnails, so the cards carry their revision dots
    // on the first paint rather than after a second pass.
    revCountsBySheet = sheetsWithRevisions(opened.pageCount, allRevisions(), sheetOrigin());
    // Another job's answers are not this one's.
    countAsked.clear();
    syncTiles({ paint: false });
    clearOverlay({ draw: false });
    // Another project's dimensions are not this one's, and they are keyed by
    // page index — left behind they would draw over whatever sheet took that
    // number.
    app.scratch.clear();
    // A project opens in View Only. The setting exists for an estimator who
    // lives in Edit Mode; it defaults to false, which is what was asked for.
    setEditing(!!app.settings.get('open_in_edit_mode'), { announce: false });
    thumbs.refresh(0);
    const start = Math.min(
      Math.max(0, Number(app.project.metadata.last_viewed_page) || 0),
      opened.pageCount - 1
    );
    pageImage = null;
    await goToPage(Math.max(0, start));
    syncVersionUi({ rebuild: true });
    app.project.markSaved();
    // Not a library copy: Recent can only offer the OS file picker, and that
    // cannot see the browser's private storage the copy lives in.
    if (!library) noteRecent(file);
    if (handle && !archive) await adoptIfInArchive(handle, file);
    syncTitle();
    await offerDraftRestore(file);
    const mb = (file.size / 1048576).toFixed(file.size > 1e9 ? 0 : 1);
    setStatus(
      `Opened ${file.name} — ${opened.pageCount} sheet${opened.pageCount === 1 ? '' : 's'}, ${mb} MB` +
      (opened.revisions.length ? `, ${opened.revisions.length} revision set(s)` : '')
    );
    primeWatch();
    sayLeftOutAtOpen();
    return true;
  } catch (err) {
    await D.alertDialog('Could not open', `${file.name}\n\n${err.message}`);
    return false;
  } finally {
    hideProgress();
  }
}

function countItems() {
  let n = 0;
  for (const _ of app.project.allItems()) n += 1;
  return n;
}

async function saveProject({ saveAs = false } = {}) {
  // A project can be nothing but standalone items — hardware, glue, a labor
  // line — and refusing to save that loses real work with no message.
  if (!app.pages.pageCount && ![...app.project.allItems()].length) {
    setStatus('Nothing to save yet.');
    return;
  }

  // A project opened from a Plans Library copy reads every untouched sheet
  // out of that copy as it is written. If the portal has removed or replaced
  // the copy since, those reads fail part-way through — or, where a download
  // resolves before its bytes are read, the save reports success with the
  // sheets missing and the draft dropped. So check before writing anything,
  // and keep the work as a draft: the project stays dirty, the draft stays.
  if (app.libraryCopy && !(await libraryCopyReadable(app.libraryCopy.file))) {
    await saveDraftNow();
    await D.alertDialog('Saved copy no longer on this device',
      'The saved copy this project was opened from has been removed or replaced '
      + 'on this device, so the project cannot be written from it. Your changes '
      + 'are kept as a draft on this device — open the plan again ('
      + (app.libraryCopy.portal
        ? 'from the portal: 📐 on the project, or its Plans Library'
        : 'from the Plans Archive, or the list of plans on this device')
      + ') to get them back.');
    return;
  }

  // This file names revision sets whose images this app could not read, so a
  // save composed from what is in hand would write those records with no
  // TKREVS01 block behind them — on the estimator's largest job, 1.42 GB of
  // drawings gone, in place, with nothing said. Ask before writing over it.
  if (app.project.revisionsUnreadable) {
    const n = (app.project.metadata.revisions || []).length;
    const ok = await D.confirmDialog(
      'This project’s revision images could not be read',
      `${app.fileName || 'This file'} lists ${n} revision set${n === 1 ? '' : 's'}, `
      + 'but the block of drawings that holds their pages is unreadable — '
      + 'most often a file that was copied or synced while it was still being '
      + 'written.\n\n'
      + 'Saving now writes a project with those revisions EMPTY. The pages are '
      + 'not recoverable from this copy afterwards.\n\n'
      + 'Save anyway, or cancel and open a backup instead?',
      { okLabel: 'Save without the revision images', danger: true }
    );
    if (!ok) {
      setStatus('Save cancelled — the revision images in this file could not be read.');
      return;
    }
  }

  let handle = app.fileHandle;
  const handleBefore = handle;

  // A plan in the Plans Archive is shared: OneDrive keeps the folder the same
  // on every computer, so the file may have been saved somewhere else since
  // it was opened here. Writing over it then would lose that work in place,
  // with nothing said. So look first, and ask.
  if (handle && !saveAs && app.archive) {
    const verdict = await checkArchiveWrite(handle);
    if (verdict === 'cancel') return;
    if (verdict === 'save-as') saveAs = true;
  } else if (app.archive && !(await projectSourcesReadable())) {
    // Save As cannot write a project whose sheets can no longer be read
    // either: the file they came from was replaced. Keep the work instead.
    let now = null;
    try { now = handle ? await handle.getFile() : null; } catch { now = null; }
    await keepChangesAsDraft(now);
    return;
  }

  if (saveAs || !handle) {
    if (canUseFsApi) {
      // Save As starts in the archive project's own folder — the plan's, or
      // for a takeoff started from a PDF the project the PDF is in, even when
      // the PDF sits in a sub-folder: a takeoff counts only right in a
      // project's folder (the owner, 2026-10-27) — so the new one is listed
      // with the project's plans unless the estimator moves it.
      const startIn = (app.archive && app.archive.dir) || app.saveStartIn || null;
      const pick = withStart => window.showSaveFilePicker({
        suggestedName: suggestedFileName(),
        types: [{
          description: 'Takeoff Project',
          accept: { 'application/octet-stream': [FILE_EXTENSION] },
        }],
        ...(withStart ? { startIn } : {}),
      });
      try {
        handle = await pick(!!startIn);
      } catch (err) {
        if (err.name === 'AbortError') return;
        // A folder the browser will not start in any more (moved, renamed,
        // gone) is no reason not to save: ask again without it.
        if (!startIn) throw err;
        try {
          handle = await pick(false);
        } catch (err2) {
          if (err2.name === 'AbortError') return;
          throw err2;
        }
      }
    } else {
      handle = null;   // fall through to a download
    }
  }

  showProgress('Saving…', 0, app.pages.pageCount);
  try {
    const blob = await writeProject({
      metadata: app.project.buildSaveMetadata(),
      pageSources: app.pages.saveSources(),
      revisionSources: app.pages.saveRevisionSources(),
      onProgress: (done, total, label) => showProgress(label, done, total),
    });
    if (handle) {
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      app.fileHandle = handle;
      app.fileName = handle.name;
      // Every untouched sheet is a Blob slice of the file we just overwrote.
      // Chrome keeps those slices valid, but Firefox and Safari can invalidate
      // them, and a sheet would then fail to decode with the project still
      // open. Re-acquire the handle's File and re-point the page index at it.
      await reacquireAfterSave(handle);
      // What the file is now, so the next Save can tell our own write from
      // somebody else's; and a takeoff saved into the archive is one of its
      // plans from here on.
      await noteArchiveSave(handle, handle !== handleBefore);
    } else {
      const how = await downloadBlob(blob, suggestedFileName());
      if (how === 'cancelled') { setStatus('Save cancelled.'); return; }
    }
    app.project.markSaved();
    syncTitle();
    await dropDraft(draftKey(app.fileName || suggestedFileName(),
                             app.fileSize || 0));
    setStatus(`Saved ${app.fileName || suggestedFileName()}`);
  } catch (err) {
    await D.alertDialog('Could not save', err.message);
  } finally {
    hideProgress();
  }
}

/**
 * Re-point every page source at the file that was just written.
 *
 * Cheap: it re-reads the header and the index, not the sheets. Failing is not
 * fatal — the in-memory slices usually still work — so this degrades to a
 * warning rather than taking the project down with it.
 */
async function reacquireAfterSave(handle) {
  try {
    const file = await handle.getFile();
    const reopened = await openProject(file);
    if (reopened.pageCount === app.pages.pageCount) {
      app.pages.setFromProject(reopened);
      // Every sheet now comes from the file just written, so a Plans Library
      // copy the project was opened from is free to go — and the save check
      // must not keep holding this project to it.
      releaseLibraryCopy();
      pageImage = null;
      // The version on screen is carried over explicitly. Without it this
      // resolves "whatever you get when you do not ask", which is now the
      // NEWEST — so saving while working on a sheet's own drawing swapped the
      // drawing underneath the estimator and hid every item they had just
      // taken off. Re-pointing the blob slices at the re-written file is
      // bookkeeping; it must not move anybody.
      await goToPage(app.currentPage, { version: versionView.revId });
      thumbs.refresh(app.currentPage);
    }
  } catch (err) {
    console.warn('could not re-acquire the saved file; page slices kept', err);
  }
}

/* ══════════════════════════════════════════════════════════════════════
   The Plans Archive

   Plan files kept in a folder on this computer — a synced OneDrive folder
   with one folder per project — instead of handed over by the portal. The
   screens are js/ui/plans-archive.js; what is here is the part that touches
   the open project: opening with the file's handle so Save writes back into
   the folder, and checking before that write that nobody else has saved the
   file since.
   ══════════════════════════════════════════════════════════════════════ */

/** Open a .takeoff from the archive, with its handle. Resolves whether it opened. */
async function openArchiveTakeoff(entry) {
  if (app.project.dirty && !(await confirmDiscard())) return false;
  let file;
  try {
    file = await entry.handle.getFile();
  } catch {
    await D.alertDialog('Not in the folder any more',
      `${entry.name} is no longer where it was in ${entry.folderName || 'the Plans Archive'} — `
      + 'it may have been moved, renamed or deleted, or OneDrive is still bringing '
      + 'it down. Browse the Plans Archive to find it again.');
    return false;
  }
  const ok = await loadProjectFile(file, entry.handle, {
    archive: {
      stamp: fileStamp(file), dir: entry.dir || null,
      folderName: entry.folderName || '', path: entry.path || '',
    },
  });
  if (ok) {
    await plansStore.noteRecent({ ...entry, size: file.size, lastModified: file.lastModified });
  }
  return ok;
}

/** Start a new takeoff from a PDF in the archive; Save As then starts in its project's folder. */
async function startArchivePdf(entry) {
  let file;
  try {
    file = await entry.handle.getFile();
  } catch {
    await D.alertDialog('Not in the folder any more',
      `${entry.name} is no longer where it was — it may have been moved, renamed or deleted.`);
    return;
  }
  await importPdfFile(file, { saveStartIn: entry.projectDir || entry.dir || null });
}

/**
 * Before Save writes over an archive file in place: 'write', 'save-as' or
 * 'cancel'. Permission comes first, while the Save click still counts as one —
 * the browser will not show its prompt otherwise.
 */
async function checkArchiveWrite(handle) {
  let perm = await permissionOf(handle, 'readwrite');
  if (perm !== 'granted') perm = await askPermission(handle, 'readwrite');
  if (perm !== 'granted') {
    const ok = await D.confirmDialog('Not allowed to save into the folder',
      `This browser was not allowed to write to ${app.fileName}. Save it as a new `
      + 'file instead?', { okLabel: 'Save As…' });
    return ok ? 'save-as' : 'cancel';
  }
  let now = null;
  try { now = await handle.getFile(); } catch { now = null; }
  if (now && !changedSince(app.archive.stamp, now)) return 'write';
  // Every untouched sheet is a slice of the file as it was opened, and the
  // browser will not read a file that has been replaced since — so once it
  // has changed, no project can be written from here at all, in place or as
  // a new file. Keep the work instead, where reopening the plan finds it.
  if (!(await projectSourcesReadable())) return keepChangesAsDraft(now);
  return askChangedOnDisk(now);
}

/** Can the open project's sheets still be read from the file they came from? */
async function projectSourcesReadable() {
  const needsFile = app.pages.saveSources().some(s => s.kind === 'slice')
    || app.pages.revisionSheetCount() > 0;
  if (!needsFile || !app.pages.file) return true;
  return libraryCopyReadable(app.pages.file);
}

/**
 * The file was replaced (or went) after it was opened and its sheets can no
 * longer be read: keep the work as a draft keyed to the file as it is NOW, so
 * opening that file again offers it back (offerDraftRestore), and say so.
 * Always resolves 'cancel' — nothing is written.
 */
async function keepChangesAsDraft(now) {
  const work = app.project.buildSaveMetadata();
  const info = { pageCount: app.pages.pageCount, name: app.fileName || '' };
  await putDraft(currentDraftKey(), work, info);
  if (now) await putDraft(draftKey(app.fileName, now.size), work, info);
  await D.alertDialog('Changed since you opened it', now
    ? `${app.fileName} was replaced in the folder after you opened it — saved on `
      + 'another computer, or brought down by OneDrive. The drawings of the copy '
      + 'you opened are no longer there to read, so your changes cannot be '
      + 'written into a project file from here.\n\n'
      + 'Your changes are kept on this device. Open the plan again from the Plans '
      + 'Archive and choose “Restore it” when it offers your unsaved work. Your '
      + 'version then replaces the one saved elsewhere, so look at that one first.'
    : `${app.fileName} is no longer where it was opened from — moved, renamed or `
      + 'deleted, or OneDrive is replacing it — so your changes cannot be written '
      + 'into a project file from here.\n\n'
      + 'Your changes are kept on this device. When the file is back, open it and '
      + 'choose “Restore it” when it offers your unsaved work.');
  setStatus('Not saved — your changes are kept on this device as unsaved work.');
  return 'cancel';
}

/** The file changed (or went) after it was opened: say how, and let the estimator choose. */
function askChangedOnDisk(now) {
  const when = ms => new Date(ms).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const mb = n => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const was = app.archive.stamp;
  const text = now
    ? `${app.fileName} was changed after you opened it — saved from another `
      + 'computer, or brought down by OneDrive.\n\n'
      + `When you opened or last saved it: ${when(was.lastModified)}, ${mb(was.size)}\n`
      + `In the folder now: ${when(now.lastModified)}, ${mb(now.size)}\n\n`
      + 'Saving here would replace those changes with yours. Save yours as a new '
      + 'file instead, and compare the two?'
    : `${app.fileName} is no longer where it was opened from — moved, renamed or `
      + 'deleted, or OneDrive is replacing it. Save yours as a new file instead?';
  return D.showDialog(close => {
    const body = D.el('div');
    body.style.whiteSpace = 'pre-wrap';
    body.textContent = text;
    const buttons = [D.button('Cancel', '', () => close('cancel'))];
    if (now) buttons.push(D.button('Replace it anyway', 'danger', () => close('write')));
    buttons.push(D.button('Save as a new file…', 'primary', () => close('save-as')));
    return D.dlg({ title: 'Changed since you opened it', body, buttons });
  }).then(v => v || 'cancel');
}

/**
 * After a write through a handle: the archive's record of the file follows
 * it. A Save As to a new file is located again — into the archive, it is one
 * of its plans from here on; elsewhere, the guard still knows its stamp.
 */
async function noteArchiveSave(handle, isNewFile) {
  try {
    const file = await handle.getFile();
    if (isNewFile && await adoptIfInArchive(handle, file)) return;
    if (app.archive) app.archive.stamp = fileStamp(file);
  } catch { /* the next save asks again; nothing here may fail a save */ }
}

/**
 * A file opened or saved through the ordinary pickers that sits inside one of
 * this device's plan folders is an archive file all the same: Save guards it,
 * and it goes on the start screen's recent list. Resolves whether it was one.
 */
async function adoptIfInArchive(handle, file) {
  try {
    const where = await plansArchive.locate(handle);
    if (!where) return false;
    app.archive = { stamp: fileStamp(file), dir: where.dir, folderName: where.folderName, path: where.path };
    await plansStore.noteRecent({
      handle, dir: where.dir, name: handle.name, path: where.path, code: where.code,
      project: where.project, folderId: where.folderId, folderName: where.folderName,
      size: file.size, lastModified: file.lastModified,
    });
    return true;
  } catch {
    return false;   // not knowing where it is changes nothing about opening it
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Unsaved work

   A phone does not close a tab, it discards it: iOS reclaims a backgrounded
   Safari tab under memory pressure and reloads it empty when you come back.
   `beforeunload` never fires for that, and iOS would not show its prompt
   anyway. So the work — measurements, annotations, metadata, never the sheet
   pixels — is written to IndexedDB every time the page is hidden, and offered
   back when the same file is opened again.
   ══════════════════════════════════════════════════════════════════════ */

function currentDraftKey() {
  return draftKey(app.fileName || suggestedFileName(), app.fileSize || 0);
}

async function saveDraftNow() {
  try {
    if (!app.project.dirty) return;
    if (!app.pages.pageCount && ![...app.project.allItems()].length) return;
    await putDraft(currentDraftKey(), app.project.buildSaveMetadata(), {
      pageCount: app.pages.pageCount,
      name: app.fileName || '',
    });
  } catch { /* a draft that cannot be written must not break the app */ }
}

async function offerDraftRestore(file) {
  const key = draftKey(file.name, file.size);
  const draft = await getDraft(key);
  if (!draft || !draft.payload) return;

  // A draft older than the file has already been saved into it.
  if (file.lastModified && draft.savedAt <= file.lastModified + 1500) {
    await dropDraft(key);
    return;
  }

  // Measurements are keyed by page index. If the sheet count has moved since
  // the draft was written, those indices point at different sheets — so this
  // refuses rather than quietly putting a wall on the wrong drawing.
  if (draft.pageCount != null && draft.pageCount !== app.pages.pageCount) {
    setStatus(`Unsaved work found for this file, but it was measured against `
      + `${draft.pageCount} sheets and this file has ${app.pages.pageCount}. `
      + `It has been left alone rather than landing on the wrong drawings.`);
    return;
  }

  const when = new Date(draft.savedAt).toLocaleString();
  const ok = await D.confirmDialog(
    'Unsaved work found',
    `There is takeoff for "${file.name}" from ${when} that was never saved `
    + `into the file — the tab was most likely closed or reloaded first.`
    + `\n\nRestore it?`,
    { okLabel: 'Restore it' });
  if (!ok) { await dropDraft(key); return; }

  app.project.loadFrom({
    metadata: draft.payload,
    annotations: draft.payload.annotations,
    measurements: draft.payload.measurements,
    pageCount: app.pages.pageCount,
    // The draft's metadata carries no page counts for the revision sets
    // (a save strips them). Without these every revision read as one with
    // no pages: off the version bar, out of the matrix, a save refused as
    // "unreadable" — and, since 3.05, counted from nowhere.
    revisionCounts: (app.pages.revisionSlices || []).map(s => s.length),
  });
  app.project.markDirty();
  itemsPanel.refresh();
  syncVersionUi({ rebuild: true });
  primeWatch();
  thumbs.refresh(app.currentPage);
  requestDraw();
  setStatus('Unsaved work restored. Save it into the file to keep it.');
}

// Hidden, not unloading: this is the event a discarded tab actually gets.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void saveDraftNow();
});
window.addEventListener('pagehide', () => { void saveDraftNow(); });

function suggestedFileName() {
  const n = (app.project.metadata.project_name || '').trim();
  const base = n || (app.fileName ? app.fileName.replace(/\.[^.]+$/, '') : 'Takeoff');
  return `${base.replace(/[<>:"/\\|?*]+/g, '_')}${FILE_EXTENSION}`;
}

/**
 * Hand the finished project back to the user.
 *
 * On a phone this is the ONLY save — there are no writable file handles in
 * Safari — so it has to actually work there. Two problems with a plain
 * <a download>: iOS puts the file in Downloads with no say in where it goes,
 * and inside an installed home-screen app the anchor has historically done
 * nothing at all, silently.
 *
 * So where the browser can share a file, share it: iOS then offers Files,
 * Drive, Mail, AirDrop — the estimator picks where the job goes, and it
 * works the same installed or not. The anchor stays as the fallback, and is
 * still the whole story on a desktop.
 */
async function downloadBlob(blob, name) {
  const file = new File([blob], name, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (err) {
      // The user dismissing the sheet is an answer, not a failure.
      if (err && err.name === 'AbortError') return 'cancelled';
      // Anything else: fall through and try the ordinary download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

/**
 * The plain <input type=file> path, for browsers without the File System
 * Access API — which is Firefox and Safari, so most of them.
 *
 * Two things here are not optional, and both are Firefox:
 *
 *   · The input MUST be in the document. Chrome opens a picker for a detached
 *     input; Firefox silently does nothing at all, with no error anywhere.
 *   · The promise MUST settle on cancel. `change` does not fire when the user
 *     dismisses the dialog, so without this the caller awaits forever.
 *
 * It also has to be called inside the user's click, not after an await — see
 * openProjectFile.
 */
function pickFileFallback(accept, multiple = false) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    // iOS greys out every file in the Files picker when `accept` names an
    // extension it does not recognise as a UTI — and .takeoff is not one, so
    // the estimator would look at his own project and be unable to tap it.
    // No filter at all on a touch device; the name is checked below instead.
    // maxTouchPoints is the test, not the user agent: iPadOS reports itself
    // as a Mac, and it is the device that needs this.
    const touchPicker = !('showOpenFilePicker' in window)
      && navigator.maxTouchPoints > 0;
    if (!touchPicker) i.accept = accept;
    i.multiple = multiple;
    // Off-screen rather than display:none — a hidden input is not focusable in
    // some browsers, and the picker needs it to be.
    i.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(i);

    let settled = false;
    const done = value => {
      if (settled) return;
      settled = true;
      i.remove();
      resolve(value);
    };

    i.addEventListener('change', () => {
      done(multiple ? [...i.files] : i.files[0] || null);
    });
    // Chrome and Firefox 91+ fire this on dismiss.
    i.addEventListener('cancel', () => done(multiple ? [] : null));
    // Everything else: the window regains focus with no files chosen. But
    // iOS copies the picked document into the app sandbox BEFORE it fires
    // `change`, and a project off iCloud or Google Drive can be hundreds of
    // megabytes — focus comes back first and a single 400 ms check called it
    // a cancel and threw the file away. Poll instead, and only give up when
    // the whole window has passed with nothing there.
    window.addEventListener('focus', () => {
      const deadline = Date.now() + 8000;
      const tick = () => {
        if (settled) return;
        if (i.files && i.files.length) return;      // `change` will settle it
        if (Date.now() >= deadline) { done(multiple ? [] : null); return; }
        setTimeout(tick, 250);
      };
      setTimeout(tick, 400);
    }, { once: true });

    i.click();
  });
}

async function confirmDiscard() {
  if (!app.project.dirty) return true;
  return D.confirmDialog(
    'Unsaved changes',
    'This project has changes that have not been saved.\n\nOpen a different project and lose them?',
    { okLabel: 'Discard and open', danger: true }
  );
}

// ── PDF import ────────────────────────────────────────────────────────────

async function importPdfFile(file, { intoOpen = false, saveStartIn = null } = {}) {
  if (!intoOpen && app.project.dirty && !(await confirmDiscard())) return;
  const dpi = app.settings.get('import_dpi');
  showProgress('Reading PDF…', 0, 1, file.name);
  try {
    if (!intoOpen) {
      newProject();
      // A PDF from the Plans Archive: Save As starts in its folder.
      app.saveStartIn = saveStartIn || null;
      app.project.metadata.project_name = file.name.replace(/\.pdf$/i, '');
      app.project.metadata.source = file.name;
      app.project.metadata.dpi = dpi;
      app.project.metadata.import_dpi = undefined;
      delete app.project.metadata.import_dpi;
      app.project.metadata.pixels_per_foot = computePixelsPerFoot(dpi, 0.25, 1);
      setPaletteIndex(0);
    }
    const startAt = app.pages.pageCount;
    let clampedAny = false;

    const buf = await file.arrayBuffer();
    const result = await importPdf(buf, {
      dpi,
      onPage: async ({ raster, label, name }) => {
        if (raster.clampedFrom) clampedAny = true;
        const png = await canvasToPng(raster.canvas);
        app.pages.addPage({
          kind: 'png', data: png,
          width: raster.width, height: raster.height,
        });
        const idx = app.pages.pageCount - 1;
        // page_labels is the DETECTED list, indexed; page_names is a dict of
        // the user's own titles. A detected sheet title is not a user title,
        // so it goes in as a name only because nothing else carries it.
        const labels = app.project.metadata.page_labels;
        while (labels.length < idx) labels.push('');
        labels[idx] = label || '';
        if (name) app.project.metadata.page_names[String(idx)] = name;
        // Release the canvas immediately: a 300-sheet set cannot hold them.
        raster.canvas.width = raster.canvas.height = 0;
      },
      onProgress: (done, total) => showProgress('Rendering sheets…', done, total, file.name),
    });

    app.project.pageCount = app.pages.pageCount;
    if (!intoOpen) app.project.metadata.project_created = nowStamp();
    app.project.markDirty();
    hideEmptyState();
    buildScaleSelect();
    thumbs.refresh(startAt);
    pageImage = null;
    await goToPage(startAt);
    syncTitle();

    // Importing a PDF is the start of a takeoff, not a read — so this one
    // opens in Edit Mode. Opening an existing .takeoff does not.
    setEditing(true, { announce: false });

    const detected = (app.project.metadata.page_labels || []).filter(Boolean).length;
    setStatus(
      `Imported ${result.pageCount} sheet${result.pageCount === 1 ? '' : 's'} at ${dpi} DPI` +
      (detected ? ` — read ${detected} sheet number${detected === 1 ? '' : 's'}` : '')
    );
    if (clampedAny) {
      await D.alertDialog(
        'Some sheets were rendered smaller',
        `At ${dpi} DPI one or more sheets exceeded what a browser canvas can hold, ` +
        `so they were rendered at a lower resolution.\n\n` +
        `Measurements are unaffected — scale is derived from each sheet's own pixels. ` +
        `Lower the import DPI in Settings if the linework looks soft.`
      );
    }
  } catch (err) {
    if (err.name !== 'AbortError') await D.alertDialog('Could not import', err.message);
  } finally {
    hideProgress();
  }
}

function nowStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()} ${p(h)}:${p(d.getMinutes())} ${ampm}`;
}

// ── item editing ──────────────────────────────────────────────────────────

async function openProperties(item) {
  // Reachable from the items panel, which never touches the canvas hit test,
  // so the pointer gates do not cover it.
  if (controller.readOnly) { setStatus(controller.readOnlyReason); return; }
  // A reference distance has no name, floor, trade, category or unit cost —
  // not blank ones, NONE. That is the desktop's _finalize_ref_distance, and
  // its reason holds here too: a field that exists is a field some report
  // will eventually read. There is nothing on it to edit, so the dialog says
  // the one thing it does carry instead of offering to price it.
  if (item.type === 'ref_distance') {
    setStatus(`Reference distance — ${refScaleWords(item, app.project.dpi)}, `
      + 'and no part of the takeoff.');
    return;
  }
  if (item.type === 'standalone') {
    const patch = await D.askStandalone(item);
    if (patch) app.project.updateItem(item._uid, patch);
    return;
  }
  if (item.type === 'window' || item.type === 'door') {
    const patch = await D.askOpening(item.type, item);
    if (patch) app.project.updateItem(item._uid, patch);
    return;
  }
  if (item.type === 'slope_area') {
    const patch = await D.askSlopeRoof({
      flatArea: Number(item.flat_area) || 0,
      existing: item,
      color: item.color,
    });
    if (!patch) return;
    app.project.transact('Edit item', () => {
      Object.assign(item, patch);
      recompute(item);
    });
    app.project.emit('items-changed', {});
    return;
  }
  if (item.type === 'tile') {
    const patch = await D.askTile({
      tileWIn: item.tile_w_in ?? 12, tileHIn: item.tile_h_in ?? 12,
      groutIn: item.grout_in ?? 0, pattern: item.pattern || 'grid',
      wastePct: item.waste_pct ?? 10, tilesPerBox: item.tiles_per_box ?? 0,
      areaFt2: Number(item.value) || 0, color: item.color, existing: item,
    });
    if (!patch) return;
    app.project.transact('Edit item', () => {
      Object.assign(item, {
        tile_w_in: patch.tileWIn, tile_h_in: patch.tileHIn,
        grout_in: patch.groutIn, pattern: patch.pattern,
        waste_pct: patch.wastePct, tiles_per_box: patch.tilesPerBox,
        name: patch.name, floor_level: patch.floor_level,
        category: patch.category, cost_type: patch.cost_type,
        unit_cost: patch.unit_cost, color: patch.color,
      });
      recompute(item);
    });
    app.project.emit('items-changed', {});
    return;
  }

  const patch = await D.askItem({
    type: item.type, existing: item, color: item.color,
    spacingIn: item.type === 'linear_count' ? item.spacing_in : null,
    gridCells: item.type === 'grid' ? [item.cell_w_ft, item.cell_h_ft] : null,
  });
  if (!patch) return;
  app.project.transact('Edit item', () => {
    const { spacingIn, cellW, cellH, ...rest } = patch;
    Object.assign(item, rest);
    if (spacingIn != null) item.spacing_in = spacingIn;
    if (cellW != null) {
      const ppf = Number(item.ppf) || app.project.pagePpf(app.currentPage);
      item.cell_w_ft = cellW; item.cell_h_ft = cellH;
      item.cell_w_px = cellW * ppf; item.cell_h_px = cellH * ppf;
    }
    recompute(item);
  });
  app.project.emit('items-changed', {});
}

async function openMaterials(item) {
  if (controller.readOnly) { setStatus(controller.readOnlyReason); return; }
  const { openAssemblyManager } = await import('./ui/assemblies.js');
  const lines = await openAssemblyManager(item);
  if (lines) app.project.updateItem(item._uid, { associated_items: lines }, { label: 'Materials' });
}

function showItemMenu(item, ev) {
  // Delete / Hide / Properties on an item, from a drawing that item was not
  // traced on. The controller's hit test cannot produce this while a version
  // is up, but the right-button branch reaches it from a LEFTOVER selection —
  // so it is one added caller away from live, and what it removes is not on
  // screen to be seen going.
  if (controller.readOnly) {
    setStatus(controller.readOnlyReason);
    return;
  }
  const menu = $('ctxMenu');
  menu.textContent = '';
  const add = (label, fn, cls) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', () => { menu.hidden = true; fn(); });
    menu.appendChild(b);
  };
  // The two rows that would give a reference distance a name or a price are
  // not offered on one — see openProperties. Hide, Isolate, Zoom to and
  // Delete are, because it is an object on the sheet like any other.
  if (item.type !== 'ref_distance') {
    add('Properties…', () => openProperties(item));
    add('Associated materials…', () => openMaterials(item));
    menu.appendChild(document.createElement('hr'));
  }
  add(item.visible === false ? 'Show' : 'Hide',
    () => { app.project.setVisible([item._uid], item.visible === false); itemsPanel.refresh(); });
  add('Isolate this item', () => {
    app.project.isolate([item._uid]);
    setStatus('Showing this item only — View ▸ Show Everything to come back');
  });
  add('Zoom to item', () => {
    const bb = boundingBox(item.points || []);
    if (bb.w || bb.h) {
      viewport.fit({ x: bb.x - bb.w * 0.4, y: bb.y - bb.h * 0.4, w: bb.w * 1.8, h: bb.h * 1.8 });
      requestDraw();
    }
  });
  menu.appendChild(document.createElement('hr'));
  add('Delete', () => {
    app.project.removeItems([item._uid]);
    controller.selected.delete(item._uid);
    requestDraw();
  });

  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.min(ev.clientX, window.innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(ev.clientY, window.innerHeight - h - 8)}px`;
  const dismiss = () => { menu.hidden = true; document.removeEventListener('mousedown', dismiss); };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

// ── menus ─────────────────────────────────────────────────────────────────

function wireMenus() {
  const menus = $('menus');
  menus.addEventListener('click', ev => {
    const btn = ev.target.closest('.menu-btn');
    if (btn) {
      const menu = btn.parentElement;
      const wasOpen = menu.classList.contains('open');
      for (const m of menus.querySelectorAll('.menu')) m.classList.remove('open');
      if (!wasOpen) menu.classList.add('open');
      return;
    }
    const act = ev.target.closest('button[data-act]');
    if (act) {
      for (const m of menus.querySelectorAll('.menu')) m.classList.remove('open');
      safeRun(act.dataset.act);
    }
  });
  document.addEventListener('mousedown', ev => {
    if (!ev.target.closest('.menu')) {
      for (const m of menus.querySelectorAll('.menu')) m.classList.remove('open');
    }
  });
  document.addEventListener('click', ev => {
    const act = ev.target.closest('button[data-act]');
    if (act && !act.closest('.menu-pop')) safeRun(act.dataset.act);
  });
}

/**
 * Run a menu action and never let it fail in silence.
 *
 * A cancelled file picker throws AbortError, which is the user saying no and
 * not an error. Anything else the user needs to be told about — a swallowed
 * rejection here reads as "the menu is broken".
 */
function safeRun(act) {
  // Called SYNCHRONOUSLY, not through Promise.resolve().then().
  //
  // Opening a file picker needs the browser's transient user activation, and
  // Firefox drops it across a task boundary. One stray microtask hop between
  // the click and the picker was enough for "Open a .takeoff project" to do
  // nothing at all, silently.
  let result;
  try {
    result = runAction(act);
  } catch (err) {
    reportActionError(act, err);
    return;
  }
  if (result && typeof result.catch === 'function') {
    result.catch(err => reportActionError(act, err));
  }
}

/** A cancelled picker is the user saying no; anything else needs saying. */
function reportActionError(act, err) {
  if (err && err.name === 'AbortError') return;
  console.error(act, err);
  const msg = err && err.message ? err.message : String(err);
  setStatus(`${act}: ${msg}`);
  D.alertDialog('Something went wrong', msg);
}

/** Tear the open project down and start clean. */
function newProject() {
  // A dialog left open over a project that no longer exists would write its
  // result into the new one.
  D.closeAllDialogs();
  // Both of these hold ImageBitmaps that clearCaches() is about to close, and
  // a closed bitmap is still truthy — so drawing one throws InvalidStateError
  // inside the rAF callback, before anything else in the frame paints. The
  // new, empty project would sit there showing the previous job's revision
  // sheet, frozen, throwing once a frame. Cleared BEFORE the teardown.
  clearOverlay({ draw: false });
  clearVersion({ draw: false });
  app.scratch.clear();
  app.project.reset();
  app.pages.clearCaches();          // release the old ImageBitmaps
  app.pages = new PageStore();
  thumbs.pages = app.pages;
  calloutPreview.hide();
  calloutPreview.clearCache();
  revCountsBySheet = new Map();
  pageImage = null;
  pendingFit = false;
  pageTicket += 1;                  // orphan any decode still in flight
  app.currentPage = 0;
  app.fileHandle = null;
  app.fileName = '';
  app.sourceFile = null;
  app.archive = null;
  app.saveStartIn = null;
  // The old project is gone, so a library copy it was read from is no
  // longer open and the portal may tidy it away.
  releaseLibraryCopy();
  controller.selected.clear();
  controller.cancel();
  showEmptyState();
  thumbs.refresh(0);
  itemsPanel.refresh();
  syncTitle();
  syncPageOf();
  syncScaleSelect();
  syncHistoryButtons();
  syncVersionUi({ rebuild: true });
  requestDraw();
}

/**
 * Menu actions that must not run while another version of a sheet is on
 * screen.
 *
 * The pointer gate lives in the controller, but a menu reaches past it. Each
 * of these writes to the SHEET — its scale, its markup, its place in the set,
 * or the takeoff on it — from a drawing that is not the sheet.
 *
 * `set-scale` is the one worth naming: the scale is pixels-per-foot of the
 * sheet's OWN image, so recalibrating from a revision that is a different size
 * stores a number the sheet was never measured with. It is a priced, saved,
 * silent mistake, and it is reached by a control that looks harmless.
 *
 * Undo and redo are here too: their snapshots were taken against the sheet's
 * own drawing, and replaying one while looking elsewhere puts work back with
 * nothing on screen to show it landing.
 */
const REFUSED_WHEN_READ_ONLY = new Set([
  'delete', 'clear-markup',
  'set-scale', 'delete-page', 'add-blank', 'import-more', 'review-labels',
  'undo', 'redo', 'add-standalone', 'catalog',
  // Project Info writes ten saved fields through transact(), and pressing OK
  // commits even when nothing was typed.
  'project-info',
]);
// Deliberately NOT refused: 'toggle-markup', 'isolate' and 'exit-isolate'.
// All three change only what is SHOWN — `_isolation` is transient and never
// saved, and toggle-markup flips a renderer flag. Refusing them trapped a
// reader inside an isolation set in Edit Mode, with Show Everything answering
// "press Edit Mode to change the takeoff" for something that changes nothing.


async function runAction(act) {
  if (controller.readOnly && REFUSED_WHEN_READ_ONLY.has(act)) {
    setStatus(controller.readOnlyReason);
    return;
  }
  switch (act) {
    case 'new-project':
      if (!(await confirmDiscard())) return;
      newProject();
      // Back at an empty start screen: a new version that arrived while the
      // project was open can load now without costing anything.
      reloadForUpdateIfIdle();
      break;
    case 'open-project': await openProjectFile(); break;
    // Straight through: the folder picker or the browser's "allow" prompt
    // may be the first thing it shows, and both need this click.
    case 'plans-archive': await plansArchive.open(); break;
    case 'keep-on-device': await keepOnDevice(); break;
    case 'import-pdf': {
      // The picker is opened first, before anything that could await, so the
      // click's user activation is still live when it runs.
      const f = await pickFileFallback('.pdf,application/pdf');
      if (f) await importPdfFile(f);
      break;
    }
    case 'import-more': {
      if (!app.pages.pageCount) return;
      const f = await pickFileFallback('.pdf,application/pdf');
      if (f) await importPdfFile(f, { intoOpen: true });
      break;
    }
    case 'save': await saveProject(); break;
    case 'save-as': await saveProject({ saveAs: true }); break;
    case 'close-project': await runAction('new-project'); break;
    case 'project-info': await openProjectInfo(); break;

    case 'undo': app.project.undo(); itemsPanel.refresh(); requestDraw(); break;
    case 'redo': app.project.redo(); itemsPanel.refresh(); requestDraw(); break;
    case 'delete':
      if (controller.selected.size) {
        app.project.removeItems([...controller.selected]);
        controller.selected.clear();
        requestDraw();
      }
      break;
    case 'select-none':
      controller.selected.clear();
      controller.cancel();
      itemsPanel.setSelection([]);
      requestDraw();
      break;
    case 'settings': await app.settings.open(onSettingsChanged); break;

    case 'zoom-in': viewport.zoomBy(1.2); requestDraw(); break;
    case 'zoom-out': viewport.zoomBy(1 / 1.2); requestDraw(); break;
    case 'zoom-fit':
      if (pageImage) {
        pendingFit = !applyDefaultZoomTo('fit');
        requestDraw();
      }
      break;
    case 'zoom-100':
      viewport.zoom = 1;
      if (pageImage) viewport.centerOn(pageImage.width / 2, pageImage.height / 2);
      requestDraw();
      break;
    case 'zoom-width':
      if (pageImage) {
        pendingFit = !applyDefaultZoomTo('width');
        requestDraw();
      }
      break;

    case 'toggle-thumbs':
      if (isMobileLayout()) { toggleDrawer('thumbs'); break; }
      $('app').querySelector('.body').classList.toggle('no-thumbs');
      requestDraw();
      break;
    case 'toggle-items':
      if (isMobileLayout()) { toggleDrawer('items'); break; }
      $('app').querySelector('.body').classList.toggle('no-items');
      requestDraw();
      break;
    case 'ui-touch': setUiMode('touch'); break;
    case 'ui-standard': setUiMode('standard'); break;
    case 'toggle-markup-bar': {
      const bar = $('markupBar');
      bar.hidden = !bar.hidden;
      requestDraw();
      break;
    }

    // The foot bar's three chain buttons. Finish and Cancel go through the
    // keyboard map so a finger and a keyboard cannot drift apart.
    case 'chain-finish':
      if (!controller.handleKey({ key: 'Enter' })) {
        setStatus('Add at least two points first.');
      }
      syncMobileBar();
      break;
    case 'chain-undo':
      controller.undoPoint();
      syncMobileBar();
      break;
    case 'chain-cancel':
      controller.handleKey({ key: 'Escape' });
      syncMobileBar();
      break;
    case 'toggle-labels': renderer.showLabels = !renderer.showLabels; requestDraw(); break;
    case 'thumb-compact': $('thumbsPanel').classList.toggle('compact'); break;

    case 'marker-smaller': stepMarkerScale(-1); break;
    case 'marker-bigger': stepMarkerScale(+1); break;
    case 'marker-normal': app.settings.set('marker_scale', 1.0); requestDraw(); break;

    case 'prev-page': goToPage(app.currentPage - 1); break;
    case 'next-page': goToPage(app.currentPage + 1); break;
    case 'add-blank': await addBlankSheet(); break;
    case 'review-labels': await reviewSheetLabels(); break;
    case 'set-scale': $('scaleSelect').focus(); break;
    case 'delete-page': await deleteCurrentPage(); break;

    // ── view only / edit ──
    case 'toggle-mode': setEditing(!app.editing); break;
    case 'mode-view': setEditing(false); break;
    case 'mode-edit': setEditing(true); break;
    case 'scratch-undo':
      setStatus(app.scratch.undo(app.currentPage)
        ? 'Last temporary dimension removed.'
        : 'No temporary dimensions on this sheet.');
      break;
    case 'scratch-clear': {
      const n = app.scratch.count;
      if (!n) { setStatus('No temporary dimensions to clear.'); break; }
      app.scratch.clear();
      setStatus(`Cleared ${n} temporary dimension${n === 1 ? '' : 's'}.`);
      break;
    }

    // ── plan revisions ──
    case 'revisions':
      if (!app.pages.pageCount) { setStatus('Open a project first.'); break; }
      revisionsPanel.toggle('matrix');
      break;
    case 'current-set':
      if (!app.pages.pageCount) { setStatus('Open a project first.'); break; }
      revisionsPanel.show('current');
      break;
    case 'toggle-chrome-pin': setChromePinned(!chromePinned()); break;
    case 'version-prev': stepSheetVersion(-1); break;
    case 'version-next': stepSheetVersion(1); break;
    case 'version-newest':
      await showSheetVersion(app.currentPage, newestOf(app.currentPage));
      break;
    case 'count-version': await countThisVersion(); break;
    case 'compare-overlay':
      if (overlayActive()) clearOverlay(); else await startOverlay();
      break;
    case 'compare-diff': await diffCurrentVersion(); break;
    case 'overlay-align': toggleOverlayAlign(); break;
    case 'overlay-flash': toggleOverlayFlash(); break;
    case 'overlay-reset':
      overlay.dx = 0; overlay.dy = 0; requestDraw();
      setStatus('Overlay back where it started.');
      break;
    case 'overlay-off': clearOverlay(); break;

    case 'catalog': await openCatalog(); break;
    case 'add-standalone': {
      const spec = await D.askStandalone();
      if (spec) {
        app.project.addItem(STANDALONE_PAGE, spec, { label: 'Add item' });
        itemsPanel.refresh();
      }
      break;
    }
    case 'isolate':
      if (controller.selected.size) {
        app.project.isolate([...controller.selected]);
        setStatus('Showing the selection only — Tools ▸ Show Everything to come back');
      }
      break;
    case 'exit-isolate':
      app.project.clearIsolation();
      setStatus('Showing everything');
      break;

    case 'report-center': await openReportCenter(app.project, pageFinalLabel); break;
    case 'export-csv': {
      const { exportCsv } = await import('./ui/reports.js');
      exportCsv(app.project, pageFinalLabel);
      break;
    }
    case 'export-xlsx': {
      const { exportWorkbook } = await import('./ui/reports.js');
      await exportWorkbook(app.project, pageFinalLabel);
      break;
    }

    case 'toggle-markup': {
      renderer.showMarkup = !renderer.showMarkup;
      $('markupToggle').textContent = renderer.showMarkup ? 'Markup on' : 'Markup off';
      $('markupToggle').classList.toggle('on', !renderer.showMarkup);
      setStatus(renderer.showMarkup ? 'Showing markup' : 'Markup hidden');
      requestDraw();
      break;
    }
    case 'clear-markup': {
      const list = app.project.annotations[app.currentPage] || [];
      const erasable = list.filter(a => a.subtype !== 'cad');
      if (!erasable.length) { setStatus('No markup on this sheet.'); break; }
      const ok = await D.confirmDialog('Clear markup',
        `Remove ${erasable.length} highlight${erasable.length === 1 ? '' : 's'} and pen ` +
        `stroke${erasable.length === 1 ? '' : 's'} from ${pageFinalLabel(app.currentPage)}?\n\n` +
        'Takeoff items are not affected.',
        { okLabel: 'Clear markup', danger: true });
      if (!ok) break;
      app.project.removeAnnotations(erasable.map(a => a._uid), { label: 'Clear markup' });
      requestDraw();
      break;
    }
    case 'recent': await showRecent(); break;
    case 'shortcuts': await showShortcuts(); break;
    case 'about':
      await D.alertDialog('Professional Takeoff Tools — Web',
        'Smart Takeoff. Better Estimates.\n\n' +
        'The browser build of Professional Takeoff Tools. It opens and writes the ' +
        'same .takeoff project files as the desktop app, so a job can move between ' +
        'the two without an export step.');
      break;
    default: break;
  }
}

function stepMarkerScale(dir) {
  const cur = app.settings.get('marker_scale');
  let i = MARKER_STEPS.findIndex(v => Math.abs(v - cur) < 0.01);
  if (i < 0) i = MARKER_STEPS.indexOf(1.0);
  i = Math.max(0, Math.min(MARKER_STEPS.length - 1, i + dir));
  app.settings.set('marker_scale', MARKER_STEPS[i]);
  setStatus(`Marker size ${Math.round(MARKER_STEPS[i] * 100)}%`);
  requestDraw();
}

function onSettingsChanged() {
  controller.zoomStepPercent = app.settings.get('zoom_step_percent');
  controller.wheelMode = app.settings.get('wheel_mode');
  controller.uiScale = uiMode() === 'touch' ? 1.6 : 1.0;
  controller.markerScale = app.settings.get('marker_scale');
  // The nudge shortcut steps aside when the arrows are the page-turn keys.
  const nav = app.settings.get('page_nav_keys');
  controller.arrowsNavigatePages = nav === 'leftright' || nav === 'updown';
  // Where plans come from may have changed: the start screen follows.
  if (!$('emptyState').hidden) renderStartLists();
  requestDraw();
}

// ── sheets ────────────────────────────────────────────────────────────────

const SHEET_SIZES = [
  ['Arch A', 9.0, 12.0], ['Arch B', 12.0, 18.0], ['Arch C', 18.0, 24.0],
  ['Arch D', 24.0, 36.0], ['Arch E', 36.0, 48.0], ['Arch E1', 30.0, 42.0],
  ['ANSI A', 8.5, 11.0], ['ANSI B', 11.0, 17.0], ['ANSI C', 17.0, 22.0],
  ['ANSI D', 22.0, 34.0], ['ANSI E', 34.0, 44.0],
];

async function addBlankSheet() {
  const spec = await D.showDialog(close => {
    const form = D.el('div', 'form');
    const size = D.select(SHEET_SIZES.map((s, i) => [String(i), `${s[0]}  (${s[1]}″ × ${s[2]}″)`]), '3');
    D.field(form, 'Sheet size', size);
    const orient = D.select([['land', 'Landscape'], ['port', 'Portrait']], 'land');
    D.field(form, 'Orientation', orient);
    const label = D.input('');
    D.field(form, 'Sheet number', label, 'Optional — e.g. SK-1');
    const name = D.input('');
    D.field(form, 'Sheet title', name);
    return D.dlg({
      title: 'Add Blank Sheet',
      body: form,
      buttons: [
        D.button('Cancel', '', () => close(null)),
        D.button('Add', 'primary', () => close({
          size: SHEET_SIZES[Number(size.value)],
          landscape: orient.value === 'land',
          label: label.value.trim(), name: name.value.trim(),
        })),
      ],
    });
  });
  if (!spec) return;

  const dpi = app.project.dpi;
  const [, shortIn, longIn] = spec.size;
  const wIn = spec.landscape ? longIn : shortIn;
  const hIn = spec.landscape ? shortIn : longIn;
  const c = document.createElement('canvas');
  c.width = Math.round(wIn * dpi);
  c.height = Math.round(hIn * dpi);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  const png = await canvasToPng(c);
  // On an empty project there is no "after the current sheet" — index 0 is
  // the only place it can go, and currentPage is still 0 from the reset.
  const at = app.pages.pageCount ? app.currentPage + 1 : 0;
  app.pages.addPage({ kind: 'png', data: png, width: c.width, height: c.height }, at);
  app.project.notePagesInserted(at, 1);
  // The preview's crops are keyed by page index, and every index after
  // this one has just moved.
  calloutPreview.clearCache();
  if (spec.label) app.project.setPageLabel(at, spec.label);
  if (spec.name) app.project.setPageName(at, spec.name);
  c.width = c.height = 0;
  thumbs.refresh(at);
  await goToPage(at);
  setStatus(`Added a blank ${spec.size[0]} sheet`);
}

async function deleteCurrentPage() {
  if (app.pages.pageCount <= 1) {
    await D.alertDialog('Cannot delete', 'A project needs at least one sheet.');
    return;
  }
  const n = (app.project.measurements[app.currentPage] || []).length;
  // By QUANTITY: "It carries 3 takeoff items" says nothing about money.
  const onIt = (app.project.measurements[app.currentPage] || []).filter(isTakeoffItem);
  const words = takeoffQuantityWords(onIt, 6);
  const asked = app.currentPage;
  const askedSheet = pageFinalLabel(asked);
  const ok = await D.confirmDialog(
    'Delete sheet',
    `Delete ${askedSheet}?` +
    (words ? `\n\nIts takeoff goes with it: ${words}.`
      : (n ? `\n\nIt carries ${n} mark${n === 1 ? '' : 's'}, which go with it.` : '')),
    { okLabel: 'Delete sheet', danger: true }
  );
  if (!ok) return;
  // The sheet he was asked about, not whatever is on screen now.
  if (app.currentPage !== asked || pageFinalLabel(asked) !== askedSheet) {
    setStatus(`${askedSheet} was not deleted: the sheet on screen changed while the question was open.`);
    return;
  }
  const idx = app.currentPage;
  const before = countingModel().countedQuantities();
  app.pages.removePage(idx);
  app.project.notePageRemoved(idx);
  const moved = takeoffMoveWords(before, countingModel().countedQuantities());
  setStatus(`Deleted ${askedSheet}.`);
  if (moved) sayPrice(`In your totals: ${moved}.`);
  calloutPreview.clearCache();        // its crops are keyed by page index
  thumbs.refresh(Math.min(idx, app.pages.pageCount - 1));
  pageImage = null;
  await goToPage(Math.min(idx, app.pages.pageCount - 1));
}

async function reviewSheetLabels() {
  if (!app.pages.pageCount) return;
  await D.showDialog(close => {
    const body = D.el('div');
    const table = D.el('table', 'grid');
    const thead = D.el('thead');
    const hr = D.el('tr');
    for (const h of ['#', 'Sheet number', 'Sheet title']) hr.appendChild(D.el('th', null, h));
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = D.el('tbody');
    const inputs = [];
    for (let i = 0; i < app.pages.pageCount; i++) {
      const tr = D.el('tr');
      tr.appendChild(D.el('td', null, String(i + 1)));
      const li = D.input(app.project.pageLabel(i));
      const ni = D.input(app.project.pageName(i));
      li.placeholder = app.project.detectedLabel(i) || `Pag: ${i + 1}`;
      for (const n of [li, ni]) {
        n.style.cssText = 'width:100%;background:#1c1c1c;color:#dedede;border:1px solid #303030;border-radius:4px;padding:4px 6px;font:inherit';
      }
      const td1 = D.el('td'); td1.appendChild(li); tr.appendChild(td1);
      const td2 = D.el('td'); td2.appendChild(ni); tr.appendChild(td2);
      inputs.push([li, ni]);
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    body.appendChild(table);
    return D.dlg({
      title: 'Review Sheet Numbers',
      wide: true,
      body,
      buttons: [
        D.button('Cancel', '', () => close(null)),
        D.button('Apply', 'primary', () => {
          app.project.transact('Rename sheets', () => {
            // Only what differs from the detected label is stored as an
            // override, so re-typing what the drawing says clears it.
            const custom = {}, names = {};
            inputs.forEach(([li, ni], i) => {
              const label = li.value.trim();
              const name = ni.value.trim();
              if (label && label !== app.project.detectedLabel(i)
                  && label !== `Pag: ${i + 1}`) custom[String(i)] = label;
              if (name) names[String(i)] = name;
            });
            app.project.metadata.page_labels_custom = custom;
            app.project.metadata.page_names = names;
          });
          thumbs.refresh(app.currentPage);
          syncPageOf();
          itemsPanel.refresh();
          close(true);
        }),
      ],
    });
  });
}

async function openProjectInfo() {
  // Ten saved fields, committed through transact() — an edit, reached from a
  // menu rather than from the canvas, so no pointer gate covers it.
  if (controller.readOnly) { setStatus(controller.readOnlyReason); return; }
  const md = app.project.metadata;
  const patch = await D.showDialog(close => {
    const form = D.el('div', 'form');
    const f = {};
    const add = (key, label, hint) => {
      f[key] = D.field(form, label, D.input(md[key] || ''), hint);
    };
    add('project_name', 'Project name');
    add('internal_id_number', 'Job number');
    add('client_name', 'Client');
    add('project_address', 'Address');
    add('estimator_name', 'Estimator');
    add('bid_date', 'Bid date');
    add('project_type', 'Project type');
    add('project_status', 'Status');
    const desc = document.createElement('textarea');
    desc.value = md.project_description || '';
    D.field(form, 'Description', desc);
    const notes = document.createElement('textarea');
    notes.value = md.project_notes || '';
    D.field(form, 'Notes', notes);

    const stamps = D.el('div', 'hint');
    stamps.textContent =
      `Created ${md.project_created || '—'}   ·   Last saved ${md.project_modified || '—'}`;
    form.appendChild(D.el('label', null, ''));
    form.appendChild(stamps);

    return D.dlg({
      title: 'Project Info',
      body: form,
      buttons: [
        D.button('Cancel', '', () => close(null)),
        D.button('OK', 'primary', () => {
          const out = {};
          for (const [k, node] of Object.entries(f)) out[k] = node.value.trim();
          out.project_description = desc.value;
          out.project_notes = notes.value;
          close(out);
        }),
      ],
    });
  });
  if (!patch) return;
  app.project.transact('Project info', () => Object.assign(app.project.metadata, patch));
  syncTitle();
}

/**
 * Recently opened projects.
 *
 * Only a list of names and sizes: a browser cannot reopen a file by path, and
 * pretending otherwise would give the user a link that silently does nothing.
 * Picking one opens the file picker with that name as the hint.
 */
const RECENT_KEY = 'ptt.recent.v1';

function noteRecent(file) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const entry = {
      name: file.name,
      size: file.size,
      project: app.project.metadata.project_name || '',
      at: new Date().toISOString(),
    };
    const next = [entry, ...list.filter(r => r.name !== entry.name)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* a blocked store is not an error worth surfacing */ }
}

async function showRecent() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { /* none */ }
  await D.showDialog(close => {
    const body = D.el('div');
    if (!list.length) {
      const p = D.el('div', 'hint', 'Nothing opened in this browser yet.');
      p.style.padding = '12px 0';
      body.appendChild(p);
    } else {
      const note = D.el('div', 'hint');
      note.style.cssText = 'margin-bottom:10px';
      note.textContent =
        'A browser cannot reopen a file from a path, so picking one here opens ' +
        'the file chooser. Drag a project onto the window to skip that step.';
      body.appendChild(note);

      const table = D.el('table', 'grid');
      const tb = D.el('tbody');
      for (const r of list) {
        const tr = D.el('tr');
        const nameCell = D.el('td');
        nameCell.appendChild(D.el('div', null, r.project || r.name));
        const sub = D.el('div', null, r.name);
        sub.style.cssText = 'font-size:10.5px;color:#7d7d7d';
        nameCell.appendChild(sub);
        tr.appendChild(nameCell);
        tr.appendChild(D.el('td', 'num', `${(r.size / 1048576).toFixed(1)} MB`));
        tr.appendChild(D.el('td', null, new Date(r.at).toLocaleDateString('en-US')));
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => { close(true); safeRun('open-project'); });
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      body.appendChild(table);
    }
    return D.dlg({
      title: 'Recent Projects',
      body,
      buttons: [
        D.button('Clear list', '', () => {
          try { localStorage.removeItem(RECENT_KEY); } catch { /* fine */ }
          close(true);
        }),
        D.button('Close', 'primary', () => close(true)),
      ],
    });
  });
}

async function showShortcuts() {
  const rows = [
    ['R', 'Pan / Select'], ['D', 'Measure'], ['A', 'Area'], ['H', 'Slope Roof'],
    ['K', 'Pitch'], ['P', 'Polyline'], ['C', 'Count'], ['W', 'Windows'],
    ['O', 'Doors'],
    ['T', 'Pen'], ['S', 'Highlight'], ['B', 'Box highlight'],
    ['E', 'Erase markup'], ['N', 'Note'],
    ['F', 'Fit to window'], ['1', 'Actual size'],
    ['Esc', 'Cancel the shape in progress, then the selection'],
    ['Enter', 'Finish the shape in progress'],
    ['Double-click', 'Finish a chain, or edit an item in Pan mode'],
    ['Right-click', 'Undo one vertex while drawing, or the item menu in Pan mode'],
    ['Right-drag / Middle-drag', 'Pan, from any tool'],
    ['Shift while drawing', 'Constrain to 45° (not Pitch)'],
    ['Shift while highlighting', 'Keep the stroke straight'],
    ['Wheel', 'Zoom about the cursor'],
    ['Del', 'Delete the selection'],
    ['Arrows', 'Nudge the selection (Shift for 10px)'],
    ['Page Up / Page Down', 'Previous / next sheet'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / redo'],
    ['Ctrl+S', 'Save'], ['Ctrl+O', 'Open'], ['Ctrl+I', 'Import PDF'],
    ['Ctrl+0', 'Normal marker size'],
    ['Ctrl+Shift+[ / ]', 'Smaller / bigger markers'],
  ];
  await D.showDialog(close => {
    const table = D.el('table', 'grid');
    const tb = D.el('tbody');
    for (const [k, v] of rows) {
      const tr = D.el('tr');
      const kd = D.el('td', null, k);
      kd.style.cssText = 'white-space:nowrap;color:#9a9a9a;width:190px';
      tr.appendChild(kd);
      tr.appendChild(D.el('td', null, v));
      tb.appendChild(tr);
    }
    table.appendChild(tb);
    return D.dlg({
      title: 'Keyboard Shortcuts', body: table,
      buttons: [D.button('Close', 'primary', () => close(true))],
    });
  });
}

// ── keyboard ──────────────────────────────────────────────────────────────

document.addEventListener('keydown', ev => {
  if (D.dialogsOpen()) return;
  // Before anything else: a preview on screen is what Escape means.
  if (ev.key === 'Escape' && calloutPreview.open) {
    ev.preventDefault();
    calloutPreview.hide();
    return;
  }
  if (ev.key === 'Escape') {
    // Escape walks back out of comparing, one layer at a time: the overlay
    // first, then the version, then the panel.
    if (overlayActive()) { ev.preventDefault(); clearOverlay(); return; }
    // A trace in progress owns Escape. This branch used to be reachable only
    // when a revision had been deliberately raised; it is now true on the
    // original of every reissued sheet, so Escape on a half-placed area threw
    // the nine points away AND navigated to another drawing.
    if (showingOldVersion() && !controller.chainLive) {
      // Back to the newest. Escape used to go to the sheet's OWN drawing,
      // which is now the oldest of the run — pressing "stop looking at this"
      // would have left the oldest possible drawing on screen.
      ev.preventDefault();
      showSheetVersion(app.currentPage, newestOf(app.currentPage));
      return;
    }
    if (revisionsPanel.open) { ev.preventDefault(); revisionsPanel.hide(); return; }
  }
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;

  const mod = ev.ctrlKey || ev.metaKey;
  if (mod) {
    const k = ev.key.toLowerCase();
    const map = {
      s: ev.shiftKey ? 'save-as' : 'save', o: 'open-project', n: 'new-project',
      i: 'import-pdf', z: 'undo', y: 'redo', '0': 'marker-normal',
    };
    if (k === 'z' && ev.shiftKey) { ev.preventDefault(); safeRun('redo'); return; }
    if (ev.shiftKey && k === '[') { ev.preventDefault(); safeRun('marker-smaller'); return; }
    if (ev.shiftKey && k === ']') { ev.preventDefault(); safeRun('marker-bigger'); return; }
    if (map[k]) { ev.preventDefault(); safeRun(map[k]); return; }
    return;
  }

  if (controller.handleKey(ev)) { ev.preventDefault(); return; }

  const nav = app.settings.get('page_nav_keys');
  const NAV = {
    pageupdown: ['PageUp', 'PageDown'], leftright: ['ArrowLeft', 'ArrowRight'],
    updown: ['ArrowUp', 'ArrowDown'], brackets: ['[', ']'], commaperiod: [',', '.'],
  }[nav] || ['PageUp', 'PageDown'];
  if (ev.key === NAV[0]) { ev.preventDefault(); stepSheet(-1); return; }
  if (ev.key === NAV[1]) { ev.preventDefault(); stepSheet(1); return; }

  // Left and Right walk the VERSIONS of the sheet in view — unless the user
  // has bound them to turning pages, in which case the bar's own arrows and
  // the pips are the way, and stealing the keys would take away the only way
  // through the set.
  if (nav !== 'leftright' && VersionBar.shouldShow(allRevisions())) {
    if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepSheetVersion(-1); return; }
    if (ev.key === 'ArrowRight') { ev.preventDefault(); stepSheetVersion(1); return; }
  }

  // The desktop's markup keys. T for draw, S for highlight, B for box,
  // E for erase, N for note.
  const MARKUP_KEYS = { T: 'draw', S: 'highlight', B: 'highlight_rect', E: 'erase', N: 'textnote' };
  if (MARKUP_KEYS[ev.key.toUpperCase()]) {
    ev.preventDefault();
    controller.setMode(MARKUP_KEYS[ev.key.toUpperCase()]);
    return;
  }

  const shortcuts = app.settings.get('shortcuts');
  const key = ev.key.toUpperCase();
  for (const [mode, sc] of Object.entries(shortcuts)) {
    if (sc && sc.toUpperCase() === key && TOOLS.some(t => t[0] === mode)) {
      ev.preventDefault();
      controller.setMode(mode);
      return;
    }
  }
  // M for the menus. Toggles the PIN rather than peeking, because a keyboard
  // press is a decision and a hover is a glance.
  if (key === 'M') { ev.preventDefault(); setChromePinned(!chromePinned()); return; }
  if (key === 'F') { ev.preventDefault(); safeRun('zoom-fit'); }
  if (key === '1') { ev.preventDefault(); safeRun('zoom-100'); }
});

// ── drag and drop ─────────────────────────────────────────────────────────

const veil = $('dropVeil');
let dragDepth = 0;
window.addEventListener('dragenter', ev => {
  if (![...ev.dataTransfer.types].includes('Files')) return;
  ev.preventDefault();
  dragDepth += 1;
  veil.hidden = false;
});
window.addEventListener('dragover', ev => {
  if ([...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) veil.hidden = true;
});
window.addEventListener('drop', async ev => {
  ev.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  const file = ev.dataTransfer.files[0];
  if (!file) return;
  const n = file.name.toLowerCase();
  if (n.endsWith(FILE_EXTENSION) || n.endsWith(LEGACY_EXTENSION)) {
    if (await confirmDiscard()) await loadProjectFile(file);
  } else if (n.endsWith('.pdf')) {
    // Adding sheets to the open project is an edit, and a drop does not go
    // through the menu gate. But refusing to ASK is worse than the edit was:
    // it closed the set the user was reading, without a word, and there is no
    // way back but reopening the file. So the question stands, and choosing
    // to append is choosing to edit.
    if (app.pages.pageCount && await askAppend(file)) {
      if (!app.editing) setEditing(true, { announce: false });
      await importPdfFile(file, { intoOpen: true });
    } else {
      if (app.pages.pageCount && !(await confirmDiscard())) return;
      await importPdfFile(file, { intoOpen: false });
    }
  } else {
    setStatus(`${file.name} is not a takeoff project or a PDF`);
  }
});

async function askAppend(file) {
  return D.confirmDialog(
    'Add to this project?',
    `Add the sheets from ${file.name} to the project that is already open?\n\n` +
    `Choose Cancel to start a new project from it instead.`,
    { okLabel: 'Add to this project' }
  );
}

// ── panel resizing ────────────────────────────────────────────────────────

for (const grip of document.querySelectorAll('.grip')) {
  grip.addEventListener('pointerdown', ev => {
    ev.preventDefault();
    grip.setPointerCapture(ev.pointerId);
    const which = grip.dataset.target;
    const startX = ev.clientX;
    const prop = which === 'thumbs' ? '--thumb-w' : '--items-w';
    const start = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop));
    const move = e => {
      const d = which === 'thumbs' ? e.clientX - startX : startX - e.clientX;
      const next = Math.max(140, Math.min(560, start + d));
      document.documentElement.style.setProperty(prop, `${next}px`);
      requestDraw();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      app.settings.set(which === 'thumbs' ? 'thumb_width' : 'items_width',
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue(prop)));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    // Without this, a cancelled drag (a browser gesture, a lost pointer) leaves
    // the move handler live and the panel resizes on plain hover.
    grip.addEventListener('pointercancel', up);
  });
}

// ── status, title, chrome ─────────────────────────────────────────────────

let statusTimer = null;
function setStatus(text) {
  $('statusText').textContent = text || '';
  clearTimeout(statusTimer);
  if (text && !text.includes('\n')) {
    statusTimer = setTimeout(() => {
      $('statusText').textContent = HINTS[controller.mode] || 'Ready';
    }, 6000);
  }
}

function syncTitle() {
  const name = (app.project.metadata.project_name || '').trim()
    || app.fileName || 'Untitled';
  $('projTitle').textContent = name;
  $('dirtyDot').hidden = !app.project.dirty;
  document.title = `${app.project.dirty ? '• ' : ''}${name} — Professional Takeoff Tools`;
}

function syncHistoryButtons() {
  $('undoBtn').disabled = !app.project.canUndo;
  $('redoBtn').disabled = !app.project.canRedo;
  $('undoBtn').title = app.project.canUndo ? `Undo ${app.project.undoLabel}` : 'Nothing to undo';
  $('redoBtn').title = app.project.canRedo ? `Redo ${app.project.redoLabel}` : 'Nothing to redo';
}

function showEmptyState() {
  $('emptyState').hidden = false;
  // Back at the start screen: list whatever the Plans Library holds now,
  // and where the Plans Archive stands on this device.
  renderStartLists();
}

/** Both start-screen lists: the portal's saved copies and the Plans Archive. */
function renderStartLists() {
  renderLibraryList();
  renderArchiveSection();
}

function renderArchiveSection() {
  void plansArchive.renderStart($('esArchive')).catch(err => {
    console.warn('plans archive section', err);
  });
}
function hideEmptyState() { $('emptyState').hidden = true; }

function showProgress(label, done, total, sub = '') {
  $('progress').hidden = false;
  $('progressLabel').textContent = label;
  $('progressFill').style.width = total ? `${Math.round((done / total) * 100)}%` : '0%';
  $('progressSub').textContent = total > 1 ? `${done} / ${total}${sub ? '  ·  ' + sub : ''}` : sub;
}
function hideProgress() { $('progress').hidden = true; }

window.addEventListener('beforeunload', ev => {
  if (app.project.dirty) { ev.preventDefault(); ev.returnValue = ''; }
});

// ── what this browser can do ──────────────────────────────────────────────

/**
 * Check the capabilities the app actually depends on, once, at startup.
 *
 * Two classes of answer. A missing REQUIRED feature means projects will not
 * open at all, and the user needs to know that before they try rather than
 * after. A missing optional one changes how something behaves — Firefox has no
 * File System Access API, so Save writes a download instead of overwriting the
 * file in place — and that is worth one line, not a dialog.
 */
function checkCapabilities() {
  const missing = [];
  if (typeof DecompressionStream === 'undefined' && !globalThis.pako) {
    missing.push('reading compressed project data (DecompressionStream)');
  }
  if (typeof createImageBitmap === 'undefined') missing.push('decoding sheet images');
  if (typeof structuredClone === 'undefined') missing.push('undo history (structuredClone)');

  if (missing.length) {
    D.alertDialog('This browser is too old', [
      'Professional Takeoff Tools needs:',
      '',
      ...missing.map(m => `  · ${m}`),
      '',
      'Chrome or Edge 111+, Firefox 113+, or Safari 16.4+ will work.',
    ].join('\n'));
    return false;
  }

  const notes = [];
  if (!canUseFsApi) {
    // Firefox and Safari. Not a defect — just a different shape for saving.
    notes.push('Save downloads a new copy of the project rather than overwriting the original — your browser does not let a page write back to a file it opened.');
  }
  if (typeof OffscreenCanvas === 'undefined') {
    notes.push('Blank sheets and PDF import will be a little slower here.');
  }
  if (notes.length) {
    app.capabilityNotes = notes;
    console.info(['Takeoff Tools — browser notes:', ...notes.map(n => `· ${n}`)].join('\n'));
  }
  return true;
}

/** Everything the browser does and does not support, for the About box. */
function capabilityReport() {
  const yes = v => (v ? 'yes' : 'no');
  return [
    ['Compressed project data', yes(typeof DecompressionStream !== 'undefined')],
    ['Save in place', yes(canUseFsApi)],
    ['Off-screen canvas', yes(typeof OffscreenCanvas !== 'undefined')],
    ['Image decoding', yes(typeof createImageBitmap !== 'undefined')],
  ];
}

// ── start ─────────────────────────────────────────────────────────────────

checkCapabilities();
buildToolButtons();
buildScaleSelect();
syncScaleSelect();
wireMenus();
// A phone has 844px of height and the markup row costs 34 of them for tools
// most jobs never use. It is one tap away under View ▸ Markup Toolbar.
if (window.matchMedia('(max-width: 720px)').matches) $('markupBar').hidden = true;
// The stamp in index.html already painted the right layout; this only makes
// the menu agree with it and settles the value on a first-ever launch.
document.documentElement.dataset.ui = uiMode();
syncUiModeMenu();
// Settle the mode chrome before anything is open, so the empty state is not
// briefly offering an Edit Mode button for a project that does not exist.
syncModeUi();
// The toolbars settle into pinned-or-floating before the first paint, with
// the transition suppressed for one frame — otherwise every launch opens with
// the whole stack visibly sliding away, which reads as a fault.
appEl.classList.add('chrome-still');
syncChrome();
requestAnimationFrame(() => appEl.classList.remove('chrome-still'));
MOBILE_Q.addEventListener('change', () => { syncMobileBar(); requestDraw(); });
$('scrim').addEventListener('click', closeDrawers);
syncMobileBar();
syncHistoryButtons();
syncTitle();
onSettingsChanged();
// ── handed over by the portal ─────────────────────────────────────────────
/**
 * A project the portal asked this app to open.
 *
 * Nothing about the file travels in the URL. A pre-authed download link is a
 * credential, and a query string ends up in history, in the Referer header and
 * in anything that logs a URL — so the portal writes the details to
 * sessionStorage (same origin: both apps are served from barajas545.github.io)
 * and passes only a one-shot key in the hash. The key is consumed on arrival
 * and the hash removed, so a reload does not silently reopen a project the
 * estimator has since closed.
 *
 * The file is never downloaded. It is opened over HTTP ranges exactly as it
 * would be from disk, which is what makes a 155 MB plan set open in about a
 * second on a phone.
 *
 * A record with source "library" is different: it names a copy the Plans
 * Library already saved on this device, and goes to openLibraryCopy instead.
 */
async function openFromPortal(id) {
  let rec = null;
  const key = 'ptt.open.' + decodeURIComponent(id);
  try {
    rec = JSON.parse(sessionStorage.getItem(key) || 'null');
    sessionStorage.removeItem(key);
  } catch { /* a blocked store just means no handoff */ }
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch { /* cosmetic */ }

  // Saved on this device: no link, no network. Checked first because such a
  // record carries no url, and the check below would turn it away.
  if (rec && rec.source === 'library') {
    await openLibraryCopy(rec);
    return;
  }

  if (!rec || !rec.url) {
    // Most often a reload after the key was consumed, not a fault.
    setStatus('That project link has already been used — open it again from the portal.');
    return;
  }

  const opened = await loadProjectFile(new RemoteFile({
    url: rec.url,
    name: rec.name,
    size: rec.size,
    lastModified: Number(rec.lastModified) || 0,
    renew: renewerFor(rec.renew),
  }));
  // After the switch a portal link still works for as long as SharePoint
  // answers it — but the plan it opens is the old copy, not the archive's.
  if (opened && plansSource() === 'folder') {
    setStatus('Opened from the old portal (SharePoint). Plans are kept in the '
      + 'Plans Archive folder now — this copy may be older than the one there.');
  }
}

/**
 * How to mint a fresh download link when the current one expires.
 *
 * The portal names the endpoint and the localStorage key its token lives
 * under, rather than handing the token over — copying a bearer token into a
 * second store is a second place for it to leak from, and both apps share an
 * origin so there is no need. An app opened without a portal handoff has no
 * renewer at all and simply uses the link until it expires.
 */
function renewerFor(r) {
  if (!r || !r.url) return null;
  return async () => {
    const headers = {};
    let token = '';
    try { token = (r.tokenKey && localStorage.getItem(r.tokenKey)) || ''; } catch { /* blocked */ }
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(r.url, { headers });
    if (!res.ok) throw new Error(`Could not refresh the link (${res.status}).`);
    const d = await res.json();
    return d.downloadUrl || '';
  };
}

// ── handed over by Portal 2 (another site) ────────────────────────────────
/** Said when a hand-over brought nothing: a reload of a used tab, a tab
 *  opened without its opener (an iPhone or iPad home-screen app opens other
 *  sites that way), or a portal page that went away before it answered. */
const NOTHING_FROM_PORTAL = 'Nothing came from the portal — open the plan again from the portal (Search, or its Plans Library). '
  + 'On an iPhone or iPad, open the portal in Safari rather than from its home-screen icon.';

/** While a hand-over is waiting for its plan, a new version of this app must
 *  not reload the page under it (reloadForUpdateIfIdle). */
let portalWaiting = false;

/**
 * A plan Portal 2 hands over: its Plans Library's copy on this device, or a
 * plan in the OneDrive Plans Archive over a download link. Portal 2 is not
 * this app's site, so the two windows talk (js/core/portal-handoff.js): this
 * tab tells its opener it is ready, and takes the plan only from that window,
 * from a portal address, with this tab's nonce. Resolves when it is open (or
 * nothing came); every failure is shown here. Once this device keeps the app
 * for offline use, the portal is told so (tellPortalOffline).
 */
async function receiveFromPortal(nonce) {
  const opener = window.opener;
  if (!opener) {
    setStatus(NOTHING_FROM_PORTAL);
    return;
  }
  portalWaiting = true;
  let got;
  try {
    got = await new Promise(resolve => {
      const timer = setTimeout(() => finish(null), HANDOFF_WAIT_MS);
      function onMessage(ev) {
        if (ev.source !== opener || !isPortalOrigin(ev.origin)) return;
        const plan = openFromMessage(ev.data, nonce);
        if (plan) finish({ plan, origin: ev.origin });
      }
      function finish(v) {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(v);
      }
      window.addEventListener('message', onMessage);
      // Said only to the portal's own address: any other opener hears nothing.
      for (const origin of PORTAL_ORIGINS) {
        try { opener.postMessage(readyMessage(nonce), origin); } catch { /* that window is gone */ }
      }
    });
  } finally {
    portalWaiting = false;
  }
  if (!got) {
    setStatus(NOTHING_FROM_PORTAL);
    return;
  }
  const { plan, origin } = got;
  tellPortalOffline(opener, origin, nonce);
  if (plan.kind === 'file') {
    // Wrapped only to carry the plan's name and the version's date; no bytes
    // are copied. The copy is the portal's: Save never writes into it (Save
    // As or a download, as for any copy kept on this device), and the save
    // check finds out if the portal has replaced it since (libraryCopyReadable).
    // No date from the portal: the copy's own, never "now" (a draft newer
    // than "now" would read as already saved, and be dropped).
    const file = new File([plan.file], plan.name, {
      type: 'application/octet-stream', lastModified: plan.lastModified || plan.file.lastModified || 0,
    });
    // Nothing on this site can hold the portal's copy open (Web Locks are per
    // site): the portal keeps a copy it handed over for a week. `portal` makes
    // the save check send the person back to the portal. File › Keep on This
    // Device refuses it: the copy carries prices and belongs to the person who
    // saved it in the portal, which removes it when their Sees prices goes; a
    // copy kept by this app belongs to the device, out of the portal's reach.
    const hold = { name: plan.name, file, portal: true, number: plan.number, release() {} };
    const opened = await loadProjectFile(file, null, { library: hold });
    if (opened) {
      setStatus(plan.updateAvailable
        ? 'Opened the copy saved on this device — a newer version is in the Plans Archive; the portal downloads it while it is open.'
        : 'Opened the copy saved on this device (the portal\'s Plans Library). Save goes to Save As.');
    }
    return;
  }
  await loadProjectFile(new RemoteFile({
    url: plan.url,
    name: plan.name,
    size: plan.size,
    lastModified: plan.lastModified,
    renew: portalRenewer(opener, origin, nonce),
  }));
}

/**
 * Tell the portal, once this device really keeps the app for offline use (its
 * service worker in charge and the program in its cache), so its Plans
 * Library can say saved plans open with no signal. Asked for a few minutes:
 * a first visit installs the worker after the page has loaded.
 */
async function tellPortalOffline(opener, origin, nonce) {
  const until = Date.now() + 3 * 60 * 1000;
  while (Date.now() < until) {
    let ready = false;
    try {
      ready = !!navigator.serviceWorker?.controller
        && !!(await caches.match(new URL('js/core/takeoff-file.js', document.baseURI).href));
    } catch { ready = false; }
    if (ready) {
      try { if (!opener.closed) opener.postMessage(offlineMessage(nonce), origin); } catch { /* that window is gone */ }
      return;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

/**
 * A fresh download link from the portal tab that handed the plan over, for
 * RemoteFile when the link in hand expires. '' when there is none:
 *   · the portal page never answered (its tab closed, or it moved on to
 *     another page): every later ask is '' at once, with one word on the
 *     status line, rather than a wait on every sheet;
 *   · it answered with no link (OneDrive busy just then, or the plan was
 *     saved again in OneDrive since it was opened): said on the status line,
 *     and the next sheet asks again.
 */
function portalRenewer(opener, origin, nonce) {
  let seq = 0;
  let dead = false;
  const giveUp = () => {
    if (!dead) {
      dead = true;
      setStatus('The portal page that opened this plan has closed or moved on — open the plan again from the portal to read more sheets.');
    }
    return '';
  };
  return () => new Promise(resolve => {
    if (dead || !opener || opener.closed) { resolve(giveUp()); return; }
    const req = `r${++seq}`;
    const timer = setTimeout(() => finish('', false), RENEW_WAIT_MS);
    function onMessage(ev) {
      if (ev.source !== opener || ev.origin !== origin) return;
      const url = linkFromMessage(ev.data, nonce, req);
      if (url !== null) finish(url, true);
    }
    function finish(url, answered) {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (url) { resolve(url); return; }
      if (!answered) { resolve(giveUp()); return; }
      setStatus('The portal could not give a fresh link just now, or the plan was saved again in OneDrive — '
        + 'try the sheet again, or open the plan again from the portal.');
      resolve('');
    }
    window.addEventListener('message', onMessage);
    try { opener.postMessage(renewMessage(nonce, req), origin); } catch { finish('', false); }
  });
}

// ── plans on this device: the portal's Plans Library and this app's own ───
/**
 * Plans kept on this device so they open with no signal.
 *
 * The portal downloads each .takeoff into the origin-private file system,
 * folder "plans-library", and both apps share an origin — so PTT reads those
 * files directly. They belong to the portal: it keeps its own records in
 * IndexedDB and publishes a small read-only index to localStorage, which is
 * all the start-screen list is built from. While plans come from SharePoint
 * PTT never writes the files, the folder or the index; a library copy is a
 * mirror of the SharePoint version. Once they come from the Plans Archive the
 * portal's page retires, so PTT removes a copy when the person asks
 * (removeLibraryCopy), and keeps new ones of its own: File › Keep on This
 * Device copies the open plan into "plans-kept" (keepOnDevice).
 *
 * The names and the rules for both lists are in js/core/device-plans.js.
 */

let libraryOpening = false;

/**
 * Open a library copy — a record the portal handed over (source "library")
 * or an entry from the start-screen list. Everything that can go wrong is
 * shown here as a dialog; nothing is thrown to the caller.
 */
async function openLibraryCopy(entry) {
  // A double-tap on a list entry must not start two opens of one file.
  if (libraryOpening) return;
  libraryOpening = true;
  try {
    // The name goes straight to getFileHandle, so nothing but a plain file
    // name inside the library folder is ever looked up.
    const name = typeof entry?.file === 'string' ? entry.file : '';
    if (!PORTAL_FILE_RE.test(name)) {
      await D.alertDialog('Could not open', 'That saved plan link is not valid.');
      return;
    }
    const f = await libraryFile(name);
    if (!f) {
      await D.alertDialog('Not on this device',
        plansSource() === 'folder'
          ? 'This saved plan is no longer on this device. Open the plan from the '
            + 'Plans Archive, and use File › Keep on This Device to keep it again.'
          : 'This saved plan is no longer on this device. Open the Plans Library '
            + 'in the portal to save it again.');
      return;
    }
    const want = Number(entry.size);
    if (want > 0 && f.size !== want) {
      await D.alertDialog('Saved plan is incomplete',
        'This saved plan did not finish downloading. Open the Plans Library in '
        + 'the portal to finish or repeat the download.');
      return;
    }
    // Wrapped only to carry the display name and the SharePoint version's
    // date. No bytes are copied: PTT reads it by slices like a file from disk.
    const file = new File([f], entry.name || f.name, {
      type: 'application/octet-stream',
      lastModified: Number(entry.lastModified) || f.lastModified,
    });
    // From here until another project replaces this one, the portal must
    // not delete the copy. Taken in the same turn the File arrived in, and
    // handed to loadProjectFile, which keeps it only if the open succeeds.
    const hold = holdLibraryCopy(name, file);
    let opened = false;
    try {
      // NO handle, deliberately. This copy is the SharePoint version and
      // Save must never write into it — Save goes to Save As or a download,
      // like any other file the portal opened.
      opened = await loadProjectFile(file, null, { library: hold });
    } finally {
      // Not taken over by an open project, so nothing needs the copy kept.
      if (app.libraryCopy !== hold) hold.release();
    }
    if (opened && entry.updateAvailable === true) {
      setStatus('Opened your saved copy — a newer version is in SharePoint. '
        + 'Update it from the Plans Library.');
    }
  } catch (err) {
    await D.alertDialog('Could not open', err.message || String(err));
  } finally {
    libraryOpening = false;
  }
}

/** The library copy's File, or null when it is not on this device. */
async function libraryFile(name) {
  if (typeof navigator.storage?.getDirectory !== 'function') return null;
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(PORTAL_DIR);
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch (err) {
    if (err && err.name === 'NotFoundError') return null;
    throw err;
  }
}

/**
 * Tell the portal this library copy is open, so it is not deleted under it.
 *
 * A SHARED Web Lock named 'dcr-plans-open:<file>': the portal skips or defers
 * deleting any library file whose lock is held. It is kept until another
 * project replaces this one (loadProjectFile), the project is closed
 * (newProject) or a Save As moves its sheets to the new file
 * (reacquireAfterSave) — and the browser drops it when the page goes away.
 * Shared, because two windows may have the same plan open. The promise
 * exists before the request, so release() works even before the lock is
 * granted. Without Web Locks nothing is held and release() does nothing.
 */
function holdLibraryCopy(name, file) {
  let release = () => {};
  if (typeof navigator.locks?.request === 'function') {
    const open = new Promise(resolve => { release = resolve; });
    navigator.locks.request(`${OPEN_LOCK}${name}`, { mode: 'shared' }, () => open)
      .catch(() => { /* no lock is no worse than a browser without Web Locks */ });
  }
  return { name, file, release };
}

/** The open project no longer reads from a library copy: let it go. */
function releaseLibraryCopy() {
  if (app.libraryCopy) app.libraryCopy.release();
  app.libraryCopy = null;
}

/**
 * Can the library copy still be read? One byte from each end is enough:
 * reading a File whose file has since been deleted or replaced throws, and
 * that is exactly what saving the project would run into part-way through.
 */
async function libraryCopyReadable(file) {
  try {
    await file.slice(0, 1).arrayBuffer();
    await file.slice(Math.max(0, file.size - 1), file.size).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

/**
 * This person's finished portal copies, sorted for the list; [] when none.
 * The signed-in portal account, or — once nobody signs in there any more —
 * the last one this device saw (js/core/device-plans.js libraryOwner).
 */
function libraryEntries() {
  try {
    return portalCopies(localStorage, libraryOwner(localStorage).owner);
  } catch {
    return [];
  }
}

/** This device's kept copies (File › Keep on This Device); [] when none. */
function keptEntries() {
  try { return keptCopies(localStorage); } catch { return []; }
}

/**
 * Fill the start screen's "Plans on this device" list: the plans kept here
 * with File › Keep on This Device, then the portal's saved copies. The whole
 * section is hidden when there is nothing to show.
 *
 * Once plans come from the Plans Archive the portal's copies are mirrors of
 * the old SharePoint files that nothing updates any more. They stay listed —
 * on a phone or a tablet, which cannot open the folder, they may be the only
 * plans it has with no signal — marked as from before the move, and each can
 * be removed here (the portal's own Plans Library page retires with it).
 */
function renderLibraryList() {
  const box = $('esLibrary');
  const list = $('esLibraryList');
  if (!box || !list) return;
  const moved = plansSource() === 'folder';
  const kept = keptEntries();
  const portal = libraryEntries();
  const link = box.querySelector('a.es-lib-manage');
  // The portal's page is where its copies were managed until the plans moved.
  if (link) link.hidden = moved;
  list.replaceChildren(...devicePlanRows({ kept, portal }));
  box.hidden = !kept.length && !portal.length;
}

/**
 * The rows of a list of plans on this device: the kept copies, then the
 * portal's, each headed when both are there. The start screen's list, and a
 * #plans link's panel (js/ui/plans-archive.js linkPanel) — which offers no
 * Remove and closes itself (`beforeOpen`) as a plan is opened, once any
 * "Unsaved changes" question is answered yes.
 */
function devicePlanRows({ kept = [], portal = [] }, { removable = true, beforeOpen = null } = {}) {
  const moved = plansSource() === 'folder';
  const items = [];
  if (kept.length && portal.length) items.push(D.el('div', 'es-arch-sub', 'Kept on this device'));
  for (const e of kept) items.push(keptItem(e, { removable, beforeOpen }));
  if (portal.length && (kept.length || moved)) {
    items.push(D.el('div', 'es-arch-sub', moved ? 'Saved from SharePoint before the plans moved' : 'From the Plans Library'));
  }
  for (const e of portal) items.push(libraryItem(e, { moved, removable, beforeOpen }));
  return items;
}

/** One list row: the open button, and a Remove button beside it when this app may remove it. */
function libraryRow(button, onRemove) {
  if (!onRemove) return button;
  const row = D.el('div', 'es-lib-row');
  const del = D.el('button', 'es-lib-del', 'Remove');
  del.type = 'button';
  del.title = 'Remove this copy from this device';
  del.addEventListener('click', ev => { ev.stopPropagation(); void onRemove(); });
  row.append(button, del);
  return row;
}

/** One portal copy: which job, which file, and how old this copy is. */
function libraryItem(entry, { moved = false, removable = true, beforeOpen = null } = {}) {
  const code = String(entry.projectCode ?? '').trim();
  const title = String(entry.projectTitle ?? '').trim();
  const name = String(entry.name || entry.file);
  const folder = String(entry.folder ?? '').trim();

  const b = D.el('button', 'es-lib-item');
  b.type = 'button';
  b.appendChild(D.el('span', 'es-lib-title',
    code && title ? `${code} — ${title}` : (code || title || name)));
  // A backup and the main copy of one job can share a file name.
  b.appendChild(D.el('span', 'es-lib-file', folder ? `${folder} / ${name}` : name));

  const meta = D.el('span', 'es-lib-meta');
  const facts = [librarySize(entry.size), libraryVersionDate(entry.lastModified)]
    .filter(Boolean).join(' · ');
  if (facts) meta.appendChild(D.el('span', null, facts));
  if (moved) {
    meta.appendChild(D.el('span', 'es-lib-chip', 'From before the move'));
  } else if (entry.updateAvailable === true) {
    meta.appendChild(D.el('span', 'es-lib-chip', 'Newer version in SharePoint'));
  }
  if (meta.childNodes.length) b.appendChild(meta);

  // The link panel closes (beforeOpen) only past "Unsaved changes": Cancel keeps it.
  b.addEventListener('click', () => openAfterAsking({
    dirty: app.project.dirty, confirmDiscard, beforeOpen,
    open: () => openLibraryCopy(moved ? { ...entry, updateAvailable: false } : entry),
  }));
  // Before the switch the portal's Plans Library page manages its copies.
  return libraryRow(b, moved && removable ? () => removeLibraryCopy(entry) : null);
}

/** One kept copy: which job, which file, how big, and when it was kept. */
function keptItem(entry, { removable = true, beforeOpen = null } = {}) {
  const code = String(entry.code ?? '').trim();
  const name = String(entry.name || entry.file);
  const where = [entry.project && entry.project !== code ? entry.project : '', entry.path].filter(Boolean).join(' / ');
  const b = D.el('button', 'es-lib-item');
  b.type = 'button';
  b.appendChild(D.el('span', 'es-lib-title', code ? `${code} — ${name}` : name));
  if (where) b.appendChild(D.el('span', 'es-lib-file', where));
  const facts = [librarySize(entry.size), libraryVersionDate(entry.lastModified),
    entry.keptAt ? `kept ${new Date(Number(entry.keptAt)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '']
    .filter(Boolean).join(' · ');
  if (facts) {
    const meta = D.el('span', 'es-lib-meta');
    meta.appendChild(D.el('span', null, facts));
    b.appendChild(meta);
  }
  b.addEventListener('click', () => openAfterAsking({
    dirty: app.project.dirty, confirmDiscard, beforeOpen, open: () => openKeptCopy(entry),
  }));
  return libraryRow(b, removable ? () => removeKeptCopy(entry) : null);
}

/** Open a kept copy: like a portal copy, read in place, and Save never writes into it. */
async function openKeptCopy(entry) {
  if (libraryOpening) return;
  libraryOpening = true;
  try {
    const root = typeof navigator.storage?.getDirectory === 'function' ? await navigator.storage.getDirectory() : null;
    const f = root ? await keptFile(root, entry) : null;
    if (!f || (Number(entry.size) > 0 && f.size !== Number(entry.size))) {
      await D.alertDialog('Not on this device',
        'This kept plan is no longer whole on this device (the browser may have '
        + 'cleared it to make room). Open it from the Plans Archive and keep it again.');
      return;
    }
    const file = new File([f], entry.name || f.name, {
      type: 'application/octet-stream', lastModified: Number(entry.lastModified) || f.lastModified,
    });
    const hold = holdLibraryCopy(entry.file, file);
    try {
      await loadProjectFile(file, null, { library: hold });
    } finally {
      if (app.libraryCopy !== hold) hold.release();
    }
  } catch (err) {
    await D.alertDialog('Could not open', err.message || String(err));
  } finally {
    libraryOpening = false;
  }
}

async function removeKeptCopy(entry) {
  const ok = await D.confirmDialog('Remove from this device?',
    `Remove “${entry.name || entry.file}” from this device? ${librarySize(entry.size) || 'Its space'} is freed. `
    + 'The plan itself stays in the Plans Archive.', { okLabel: 'Remove', danger: true });
  if (!ok) return;
  try {
    const root = await navigator.storage.getDirectory();
    await removeKept({ root, store: localStorage, id: entry.id, locks: navigator.locks || null });
    setStatus(`Removed ${entry.name || 'the plan'} from this device.`);
  } catch (err) {
    await D.alertDialog('Could not remove', err.message || String(err));
  }
  renderLibraryList();
}

async function removeLibraryCopy(entry) {
  const ok = await D.confirmDialog('Remove from this device?',
    `Remove “${entry.name || entry.file}” from this device? ${librarySize(entry.size) || 'Its space'} is freed. `
    + 'It is the copy saved from SharePoint before the plans moved; the plan itself is in the Plans Archive.',
    { okLabel: 'Remove', danger: true });
  if (!ok) return;
  try {
    const root = await navigator.storage.getDirectory();
    await removePortalCopy({ root, store: localStorage, entry, locks: navigator.locks || null, dropRecords: dropPortalRecords });
    setStatus(`Removed ${entry.name || 'the plan'} from this device.`);
  } catch (err) {
    await D.alertDialog('Could not remove', err.message || String(err));
  }
  renderLibraryList();
}

/**
 * The portal's own record of a removed copy (IndexedDB "dcr-plans-library",
 * store "plans"), so its page — while it is still published — does not list
 * the copy again. Only an existing database is opened: never created here.
 */
function dropPortalRecords(file) {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open(PORTAL_DB); } catch { resolve(); return; }
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch { /* nothing to drop */ } };
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('plans')) { db.close(); resolve(); return; }
      const tx = db.transaction('plans', 'readwrite');
      const cur = tx.objectStore('plans').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) return;
        const v = c.value || {};
        if (v.file === file || (v.dl && v.dl.file === file)) c.delete();
        c.continue();
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); resolve(); };
    };
  });
}

/**
 * File › Keep on This Device: the open plan, as last saved, copied into this
 * browser's own storage so it opens from the start screen with no signal —
 * on a phone or a tablet the way to have plans offline once they come from
 * the Plans Archive. A snapshot: saving the project later does not change it,
 * and opening it again starts from it.
 */
async function keepOnDevice() {
  if (!app.fileName) { setStatus('Open a plan first, then keep it on this device.'); return; }
  if (app.libraryCopy) {
    setStatus(app.libraryCopy.portal
      ? 'This plan is saved on this device by the portal\'s Plans Library — it opens from there.'
      : 'This plan is already on this device.');
    return;
  }
  if (typeof navigator.storage?.getDirectory !== 'function') {
    await D.alertDialog('Keep on This Device', 'This browser cannot keep plan files on the device. Use Chrome or Edge, or Safari 16.4 or newer on an iPhone or iPad.');
    return;
  }
  let file = app.sourceFile;
  if (app.fileHandle) {
    try { file = await app.fileHandle.getFile(); } catch { file = app.sourceFile; }
  }
  if (!file) {
    await D.alertDialog('Keep on This Device',
      'Keep on This Device works for a plan opened from the Plans Archive or from a file on this device.');
    return;
  }
  if (app.project.dirty && !(await D.confirmDialog('Keep the plan as last saved?',
    'The copy kept on this device is the plan as it was last saved. Your unsaved changes are not in it.',
    { okLabel: 'Keep it' }))) return;
  showProgress('Keeping on this device…', 0, 1, app.fileName);
  try {
    try { await navigator.storage.persist?.(); } catch { /* the browser decides */ }
    const root = await navigator.storage.getDirectory();
    const meta = {
      name: app.fileName,
      code: (app.archive && app.archive.code) || projectCodeOf(String(app.fileName || '').split(/[\\/]/).pop()) || '',
      project: (app.archive && app.archive.project) || '',
      path: (app.archive && app.archive.path) || '',
      from: app.archive ? 'Plans Archive' : 'a file on this device',
    };
    const { entry, existed } = await keepFile({ root, store: localStorage, file, meta,
      estimate: navigator.storage.estimate ? () => navigator.storage.estimate() : null });
    setStatus(existed
      ? `${entry.name} is already kept on this device.`
      : `Kept on this device: ${entry.name} (${sizeText(entry.size)}). It opens from the start screen with no internet.`);
  } catch (err) {
    await D.alertDialog('Could not keep it on this device', err.message || String(err));
  } finally {
    hideProgress();
  }
  renderLibraryList();
}

function librarySize(bytes) {
  const n = Number(bytes);
  if (!(n > 0)) return '';
  if (n >= 1073741824) return `${(n / 1073741824).toFixed(1)} GB`;
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function libraryVersionDate(ms) {
  const n = Number(ms);
  const d = new Date(n);
  if (!(n > 0) || Number.isNaN(d.getTime())) return '';
  return 'version of '
    + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// The portal is usually open in another tab. When it saves, finishes or
// removes a plan — or someone signs in or out there — the list follows. A
// null key is the whole store being cleared.
window.addEventListener('storage', ev => {
  if (ev.key === null || ev.key === PORTAL_INDEX_KEY || ev.key === PORTAL_TOKEN_KEY || ev.key === KEPT_INDEX_KEY || ev.key === OWNER_KEY) {
    renderLibraryList();
  }
});
// Back from the Plans Library page: a page restored from the back/forward
// cache missed every storage event fired while it was away.
window.addEventListener('pageshow', ev => {
  if (ev.persisted) renderLibraryList();
});

/* Checked synchronously: an async check would let the idle status below land
   on top of "Opening project…". */
// `#portal=<nonce>`: Portal 2 handing a plan over, window to window.
const PORTAL_HANDOFF = parsePortalHash(location.hash || '');
const HANDOFF = PORTAL_HANDOFF ? null : /(?:^|[#&])open=([^&]+)/.exec(location.hash || '');
// `#plans` / `#plans=A249`: the portal's search, or a bookmark, asking for the
// Plans Archive or one job's plans in it. A project number is no credential,
// so unlike a handoff it may travel in the address.
const PLANS_LINK = HANDOFF || PORTAL_HANDOFF ? null : parsePlansLink(location.hash || '');
const IDLE_STATUS = canUseFsApi
  ? 'Open a .takeoff project, or start from a PDF.'
  : 'Open a .takeoff project, or start from a PDF.  ·  Save downloads a copy here — this browser cannot write back to the original file.';
if (PORTAL_HANDOFF) {
  // Consumed: a reload must not wait for a plan that already came.
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* cosmetic */ }
  setStatus('Opening the plan from the portal…');
  receiveFromPortal(PORTAL_HANDOFF).catch(async err => {
    setStatus('Could not open that plan.');
    await D.alertDialog('Could not open', err.message || String(err));
  }).finally(() => {
    if (!$('emptyState').hidden) renderStartLists();
    reloadForUpdateIfIdle();
  });
} else if (HANDOFF) {
  setStatus('Opening the project from the portal…');
  openFromPortal(HANDOFF[1]).catch(async err => {
    setStatus('Could not open that project.');
    await D.alertDialog('Could not open', err.message || String(err));
  }).finally(() => {
    // Nothing opened — a used link, a saved copy no longer here — so this is
    // the start screen after all, and it lists what is saved like any launch.
    if (!$('emptyState').hidden) renderStartLists();
  });
} else if (PLANS_LINK) {
  // Consumed like a handoff: a reload must not open the browser again over
  // a project the estimator has opened since.
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* cosmetic */ }
  setStatus(IDLE_STATUS);
  renderStartLists();
  plansArchive.openLink(PLANS_LINK).catch(err => console.warn('plans link', err));
} else {
  setStatus(IDLE_STATUS);
  renderStartLists();
}
// The same link followed into a tab that already has the app open changes
// only the hash, and the page does not load again.
window.addEventListener('hashchange', () => {
  const link = parsePlansLink(location.hash || '');
  if (!link) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* cosmetic */ }
  plansArchive.openLink(link).catch(err => console.warn('plans link', err));
});
requestDraw();

// The catalog backs the name box's autocomplete; a failure to load it must
// leave the app fully usable, so it is warmed in the background and never
// awaited by anything on the critical path.
loadCatalog().then(n => {
  if (n) setStatus(`Materials catalog ready — ${n.toLocaleString('en-US')} items`);
}).catch(() => {});

/**
 * A new version has taken over this page (see controllerchange below).
 *
 * Loading it means a reload, and a reload drops whatever is open — so it
 * happens only when nothing would be lost: the start screen up, nothing
 * unsaved, nothing opening or saving, no dialog waiting for an answer.
 * Returns whether it is reloading.
 */
let updateWaiting = false;
let updateReloading = false;

function reloadForUpdateIfIdle() {
  if (!updateWaiting || updateReloading) return false;
  const idle = !$('emptyState').hidden && !app.project.dirty
    && $('progress').hidden && !libraryOpening && !portalWaiting && !D.dialogsOpen();
  if (!idle) return false;
  updateReloading = true;
  location.reload();
  return true;
}

// Offline. Registered late and never awaited: a worker that fails to
// register must not stop the app from opening a project.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Was a worker already driving this page? If so, a NEW one taking over
  // means the app was updated underneath us and the HTML now on screen is
  // the old one. Reload so the markup, the stylesheet and the modules are
  // all the same version — a mismatched set is how a page ends up with
  // buttons that cannot be clicked.
  //
  // But never out from under a project. The update can arrive from anywhere
  // — the portal's hidden warm-up frame loading this app is enough — and
  // with skipWaiting and clients.claim every open window gets it at once:
  // a set of drawings being read would drop back to the start screen, and
  // iOS shows no leave-page prompt. So from an idle start screen it reloads
  // at once, as it always has; otherwise it says so and waits for the
  // project to be closed (runAction 'new-project'), or for the next launch.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || updateWaiting) return;   // first install: nothing to replace
    updateWaiting = true;
    if (!reloadForUpdateIfIdle()) {
      setStatus('A new version of Professional Takeoff Tools is ready — it '
        + 'loads when you close this project or reload the page.');
    }
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI))
      .catch(err => console.warn('offline support unavailable', err));
  });
}

// Expose the live objects for the portal embed and for debugging.
// The live objects, for the portal embed and for driving the app in tests.
window.TakeoffApp = {
  app, viewport, renderer, controller, itemsPanel, thumbs, calloutPreview,
  goToPage, loadProjectFile, importPdfFile, saveProject, runAction, newProject,
  requestDraw, pageFinalLabel,
  // Plan revisions — the same entry points the panel and the bar call, so a
  // test drives the real path rather than a parallel one.
  versionView, overlay, versionBar, revisionsPanel,
  // View Only — the same entry points the buttons call.
  setEditing, syncModeUi, VIEW_TOOLS,
  showSheetVersion, clearVersion, stepSheetVersion, stepSheet,
  goToPageOwnVersion, showLoosePage, slideSheetVersion, showingOldVersion,
  startOverlay, clearOverlay, diffCurrentVersion, composeDiff,
  allRevisions, browsingOtherVersion, syncVersionUi,
  revisionCounts: () => revCountsBySheet,
  // What counts — the same entry points the version bar and the canvas use.
  countThisVersion, countingModel, newestOf, tileStates: () => tileStates,
};

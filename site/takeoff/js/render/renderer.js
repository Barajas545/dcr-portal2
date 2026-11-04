// renderer.js — one frame of the drawing surface.
//
// PAINT ORDER, and it matters:
//   1. background
//   2. the sheet image
//   3. area fills          (under everything, so outlines stay readable)
//   4. item geometry       (lines, outlines, generated patterns)
//   5. markers             (screen space, marker_scale only)
//   6. selection outlines
//   7. the in-progress preview of whatever tool is live
//   8. labels              (screen space, on top of all geometry)
//   9. handles and grips
//
// Geometry is drawn under the viewport transform; markers, labels and handles
// are drawn in screen space so they keep a constant size at any zoom.

import { rgba, itemColor, MARKS, PREVIEW_COLORS, PREVIEW_LABEL_RGB, brighten, darken } from './theme.js';
import {
  drawEndpointDot, drawCountMarker, drawWindowMarker, drawDoorMarker,
  drawVertexHandle, drawSnapMarker, clampMarkerScale,
} from './markers.js';
import { drawLabel, drawNote, noteArrowBorder, drawNoteLeader } from './labels.js';
import {
  drawCallout, drawCalloutLeader, calloutRadius, CALLOUT_DEFAULT_IN,
} from './callouts.js';
import {
  generatedPoints, gridCellsFor, tilesFor, isAreaType, tilePatternLabel,
  notesWithPurpose,
} from '../core/measure.js';
import { pitchLabel } from '../tools/controller.js';

/**
 * The only types that get a selection or hover outline.
 * Count, window, door and page_ref are deliberately absent: their points are
 * markers, not a path, and joining them draws a line across the sheet.
 */
const SELECTION_OUTLINE_TYPES = new Set([
  'area', 'slope_area', 'grid', 'tile',
  'distance', 'polyline', 'linear_count', 'pitch', 'textnote',
  'ref_distance',
]);

/**
 * The reference distance, as the desktop draws it.
 *
 * Three signals say "this one is not in the job", and all three have to
 * survive the crossing or the tablet shows something that reads as takeoff:
 * the DASH (the desktop's glLineStipple(3, 0x3333) is six screen pixels on,
 * six off), the pale steel blue it carries in the file as its own colour, and
 * the caption over its read-out — REF_DIST_CAPTION, character for character,
 * because the printed sheet and both canvases quote it.
 */
const REF_DIST_DASH_PX = 6;
const REF_DIST_CAPTION = 'REFERENCE — not in the takeoff';

// Counting a tile run tolerates 60,000; DRAWING one stops far sooner.
const TILE_DRAW_CAP = 5000;

/**
 * A callout's two numbers. Older pins carry "4/S3.1" in `label` with `detail`
 * empty; without this they render as a bare sheet number in the whole disc.
 */
function calloutParts(m) {
  const detail = String(m.detail || '').trim();
  const sheet = String(m.ref_page_label || '').trim();
  if (detail || !String(m.label || '').includes('/')) return { detail, sheet };
  const [head, ...rest] = String(m.label).split('/');
  return { detail: head.trim(), sheet: sheet || rest.join('/').trim() };
}
import {
  itemPpf, formatFt, formatDistancePrecision, refScaleWords, DEFAULT_PPF,
} from '../core/units.js';
import {
  polygonArea, areaCentroid, pathLength, boundingBox, pointsAlongPath,
} from '../core/geom.js';

export class Renderer {
  constructor(canvas, viewport) {
    this.canvas = canvas;
    this.viewport = viewport;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.markerScale = 1.0;
    this.uiScale = 1.0;
    this.showLabels = true;
    this.showMarkup = true;
    this.background = '#1e1e1e';
    // Callouts are paper-space symbols: sized in inches on the sheet, so they
    // scale with the drawing the way a printed one does.
    this.pageDpi = 150;
    this.calloutMode = 'paper';
    this.calloutInches = CALLOUT_DEFAULT_IN;
    this.calloutFill = null;
  }

  /**
   * Paint everything.
   *
   * @param {object} f  the frame
   * @param {ImageBitmap|null} f.pageImage
   * @param {Array} f.items          measurements on this page
   * @param {Array} f.annotations
   * @param {(item:object)=>boolean} f.isVisible
   * @param {Set<string>} f.selected  selected item ids
   * @param {string|null} f.hoverId
   * @param {object|null} f.preview   the live tool preview
   * @param {object|null} f.marquee   {x,y,w,h} in page space
   * @param {number} f.ppf            the page's scale, for previews only
   */
  draw(f) {
    const ctx = this.ctx;
    const vp = this.viewport;
    const ms = clampMarkerScale(this.markerScale);

    vp.applyScreenTransform(ctx);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, vp.width, vp.height);

    // A comparison paints both drawings itself, on its own paper. The sheet's
    // raster underneath would be a third copy of the older one, in black,
    // under a blue copy of itself.
    const comparing = !!(f.overlay && f.overlay.older);
    if (f.pageImage && !comparing) this._drawPage(f.pageImage);
    // Another version of this sheet, laid over it. Before the takeoff, because
    // the takeoff is what the comparison is for.
    if (f.overlay) this._drawOverlay(f.overlay, f.pageImage);

    const items = f.items || [];
    const visible = items.filter(m => (f.isVisible ? f.isVisible(m) : m.visible !== false));

    // 3 + 4 — geometry, under the world transform.
    vp.applyTransform(ctx);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const m of visible) this._drawItemFills(ctx, m);
    for (const m of visible) this._drawItemGeometry(ctx, m);
    if (this.showMarkup) for (const a of (f.annotations || [])) this._drawAnnotation(ctx, a);

    // 5 — markers, in screen space.
    vp.applyScreenTransform(ctx);
    for (const m of visible) this._drawItemMarkers(ctx, m, ms);

    // 6 — selection.
    if (f.selected && f.selected.size) {
      vp.applyTransform(ctx);
      for (const m of visible) {
        if (f.selected.has(m._uid)) this._drawSelection(ctx, m);
      }
      vp.applyScreenTransform(ctx);
    }
    if (f.hoverId) {
      const m = visible.find(i => i._uid === f.hoverId);
      if (m && !(f.selected && f.selected.has(m._uid))) {
        vp.applyTransform(ctx);
        this._drawHover(ctx, m);
        vp.applyScreenTransform(ctx);
      }
    }

    // 7 — the live tool preview.
    if (f.preview) this._drawPreview(ctx, f.preview, f.ppf ?? DEFAULT_PPF, ms);
    if (f.markup) this._drawMarkupPreview(ctx, f.markup);

    // 8 — labels. The callout draws its own selection ring, so the label pass
    // is the one place that needs the selection.
    this._selectedNow = f.selected || null;
    if (this.showLabels) {
      for (const m of visible) this._drawItemLabel(ctx, m, ms);
    }
    if (f.preview) this._drawPreviewLabel(ctx, f.preview, f.ppf ?? DEFAULT_PPF);

    // 9 — handles, marquee, snap.
    if (f.selected && f.selected.size) {
      for (const m of visible) {
        if (f.selected.has(m._uid)) this._drawHandles(ctx, m, f);
      }
    }
    if (f.marquee) this._drawMarquee(ctx, f.marquee);
    if (f.snap) {
      const [sx, sy] = vp.toScreen(f.snap.point[0], f.snap.point[1]);
      drawSnapMarker(ctx, sx, sy, f.snap.kind);
    }
  }

  _drawPage(img) {
    const ctx = this.ctx;
    const vp = this.viewport;
    vp.applyTransform(ctx);
    // A plan sheet zoomed out to fit is a heavy downsample; smoothing is what
    // keeps hairlines from aliasing into nothing. Zoomed in past 1:1 the
    // opposite is true — nearest keeps the linework crisp.
    ctx.imageSmoothingEnabled = vp.zoom < 1.5;
    ctx.imageSmoothingQuality = 'high';
    // The destination size is explicit because a sheet may have been decoded
    // smaller than it is — see ReducedPage. For a full-size bitmap `img.width`
    // IS the intrinsic width, so this is the same draw it always was.
    ctx.drawImage(img.bitmap || img, 0, 0, img.width, img.height);
    ctx.imageSmoothingEnabled = true;
    vp.applyScreenTransform(ctx);
  }

  /**
   * Another version of this sheet, laid over it in one flat colour.
   *
   * `image` arrives already tinted: its paper is transparent and its lines
   * carry the colour, so a plain source-over draw at `alpha` puts the
   * revision's linework on top of the sheet's without hiding what is under it.
   * That is exactly what the desktop's GL_MODULATE overlay produces.
   *
   * `dx`/`dy` are in SHEET pixels, not screen pixels, so a nudge made while
   * zoomed in survives zooming out and the two drawings stay in register.
   */
  _drawOverlay(o, pageImage) {
    const ctx = this.ctx;
    const vp = this.viewport;
    const img = o.image.bitmap || o.image;
    vp.applyTransform(ctx);
    ctx.save();
    ctx.imageSmoothingEnabled = vp.zoom < 1.5;
    ctx.imageSmoothingQuality = 'high';
    const w = o.image.width || img.width;
    const h = o.image.height || img.height;

    // The paper the comparison is printed on.
    //
    // Painted here rather than inherited from the background, because the
    // background is a user setting and this has to read the same whether it
    // is near-black or white. It is sized from the SHEET, not the overlay:
    // the two drawings can differ by a few pixels and the plate has to cover
    // whichever is larger or a white seam shows down one edge.
    if (o.older && o.paper) {
      const pw = Math.max(w, (pageImage && (pageImage.width || 0)) || 0);
      const ph = Math.max(h, (pageImage && (pageImage.height || 0)) || 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = o.paper;
      ctx.fillRect(0, 0, pw, ph);
    }

    // The older drawing first, so where neither moved the newer lands on top
    // of it and the pair reads as one dark line rather than as a change.
    if (o.older) {
      const oimg = o.older.bitmap || o.older;
      ctx.globalAlpha = Math.max(0, Math.min(1, o.olderAlpha == null ? 1 : o.olderAlpha));
      if (ctx.globalAlpha > 0) {
        ctx.drawImage(oimg, 0, 0, o.older.width || oimg.width, o.older.height || oimg.height);
      }
    }

    ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha == null ? 0.5 : o.alpha));
    if (ctx.globalAlpha > 0) ctx.drawImage(img, o.dx || 0, o.dy || 0, w, h);
    if (o.outline) {
      // While Align is on, show where the overlay's edges are — a sheet that
      // is mostly white paper otherwise gives nothing to drag against.
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = 'rgb(255,77,77)';
      ctx.lineWidth = 2 / vp.zoom;
      ctx.strokeRect(o.dx || 0, o.dy || 0, w, h);
    }
    ctx.restore();
    vp.applyScreenTransform(ctx);
  }

  // ── item geometry ───────────────────────────────────────────────────

  _drawItemFills(ctx, m) {
    if (!isAreaType(m.type)) return;
    const pts = m.points || [];
    if (pts.length < 3) return;
    const c = itemColor(m);
    // Grid and tile fill much lighter than a plain area — they already carry
    // dense cell or joint linework on top, and at full alpha the sheet under
    // them is blotted out and the joints are unreadable against their own fill.
    const k = m.type === 'grid' ? 0.3 : m.type === 'tile' ? 0.25 : 1;
    ctx.beginPath();
    tracePath(ctx, pts, true);
    ctx.fillStyle = rgba(c, c[3] * k);
    // Even-odd matches the desktop app's stencil fill, so a shape drawn with a
    // hole in it reads the same way here.
    ctx.fill('evenodd');
  }

  _drawItemGeometry(ctx, m) {
    const pts = m.points || [];
    if (!pts.length) return;
    const c = itemColor(m);
    const z = this.viewport.zoom;
    const w = px => px / z;    // a screen-pixel width under the world transform

    // A TEMPORARY dimension is drawn dashed, and it has to LOOK temporary —
    // an estimator who mistakes one for takeoff will go looking for it in the
    // estimate. The dash is in screen pixels so it stays a dash at any zoom.
    //
    // A reference distance dashes for the neighbouring reason: it is a real
    // measurement, but of a detail at its own scale and no part of the job.
    // Same rule, same screen-pixel dash.
    const dashed = !!m.scratch || m.type === 'ref_distance';
    const restoreDash = dashed ? ctx.getLineDash() : null;
    if (m.scratch) ctx.setLineDash([w(7), w(5)]);
    else if (m.type === 'ref_distance') {
      ctx.setLineDash([w(REF_DIST_DASH_PX), w(REF_DIST_DASH_PX)]);
    }

    switch (m.type) {
      case 'distance': {
        if (pts.length < 2) return;
        ctx.lineWidth = w(2.5);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        ctx.lineTo(pts[1][0], pts[1][1]);
        ctx.stroke();
        break;
      }
      case 'ref_distance': {
        // 2.0 and not the 2.5 a distance gets: the lower weight is part of
        // saying this is not a quantity. `break`, not the `return` its
        // neighbours use, so the dash below is always put back — a dash left
        // on the context turns the next real measurement into a fake one.
        if (pts.length >= 2) {
          ctx.lineWidth = w(2.0);
          ctx.strokeStyle = rgba(c, 1);
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          ctx.lineTo(pts[1][0], pts[1][1]);
          ctx.stroke();
        }
        break;
      }
      case 'pitch': {
        if (pts.length < 2) return;
        const [sx, sy] = pts[0], [ex, ey] = pts[1];
        ctx.lineWidth = w(1.4);
        ctx.strokeStyle = rgba(c, 0.5);
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.lineWidth = w(2.5);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, ey);
        ctx.stroke();
        break;
      }
      case 'area':
      case 'slope_area': {
        if (pts.length < 3) return;
        ctx.lineWidth = w(2.0);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        tracePath(ctx, pts, true);
        ctx.stroke();
        break;
      }
      case 'polyline': {
        if (pts.length < 2) return;
        ctx.lineWidth = w(2.5);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        tracePath(ctx, pts, false);
        ctx.stroke();
        break;
      }
      case 'linear_count': {
        if (pts.length < 2) return;
        ctx.lineWidth = w(2.0);
        ctx.strokeStyle = rgba(c, 0.7);
        ctx.beginPath();
        tracePath(ctx, pts, false);
        ctx.stroke();
        break;
      }
      case 'grid': {
        if (pts.length < 3) return;
        ctx.lineWidth = w(2.0);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        tracePath(ctx, pts, true);
        ctx.stroke();
        this._drawGridLines(ctx, m, c, w);
        break;
      }
      case 'tile': {
        if (pts.length < 3) return;
        ctx.lineWidth = w(2.0);
        ctx.strokeStyle = rgba(c, 1);
        ctx.beginPath();
        tracePath(ctx, pts, true);
        ctx.stroke();
        this._drawTiles(ctx, m, c, w);
        break;
      }
      case 'textnote':
      case 'page_ref':
        // Both are drawn whole in the label pass, which is where their screen
        // size is known. Nothing to do under the world transform.
        break;
      default:
        break;
    }
    // Put the dash back, or every item drawn after a dashed one inherits it
    // — and real takeoff that looks temporary is the same mistake in the
    // other direction.
    if (dashed) ctx.setLineDash(restoreDash || []);
  }

  _drawGridLines(ctx, m, c, w) {
    const grid = gridCellsFor(m);
    if (!grid || !grid.cells.length) return;
    const ink = darken(c, 0.45);
    ctx.save();
    try {
      ctx.beginPath();
      tracePath(ctx, m.points, true);
      ctx.clip('evenodd');
      ctx.lineWidth = w(1.8);
      ctx.strokeStyle = rgba(ink, MARKS.gridInkAlpha);
      ctx.beginPath();
      for (const quad of grid.cells) traceQuad(ctx, quad);
      ctx.stroke();
    } finally {
      // restore() must run even if a path op throws, or the clip leaks into
      // every later pass and the rest of the sheet vanishes.
      ctx.restore();
    }
  }

  _drawTiles(ctx, m, c, w) {
    const layout = this._tileLayout(m);
    if (!layout) return;
    if (layout.capped) {
      // Too dense to outline: the joints would be closer than a pixel. Wash
      // the area instead of drawing nothing, so the run is still visible.
      ctx.save();
      ctx.beginPath();
      tracePath(ctx, m.points, true);
      ctx.fillStyle = rgba(darken(c, 0.45), 0.18);
      ctx.fill('evenodd');
      ctx.restore();
      return;
    }
    const ink = darken(c, 0.45);
    ctx.save();
    try {
      ctx.beginPath();
      tracePath(ctx, m.points, true);
      ctx.clip('evenodd');
      ctx.lineWidth = w(1.5);
      ctx.strokeStyle = rgba(ink, MARKS.gridInkAlpha);
      ctx.beginPath();
      for (const quad of layout.whole) traceQuad(ctx, quad);
      ctx.stroke();
      // Cut tiles read lighter, so the estimator can see where the waste is.
      ctx.strokeStyle = rgba(ink, 0.5);
      ctx.beginPath();
      for (const quad of layout.cut) traceQuad(ctx, quad);
      ctx.stroke();
    } finally {
      ctx.restore();
    }
  }

  /**
   * The tile layout for the DRAW pass, memoised per item.
   *
   * Rebuilding it every frame cost 59 ms on a 55,000-tile floor — the drag
   * stopped tracking the cursor. The key is everything the layout depends on,
   * so an edit invalidates it and nothing else does.
   */
  _tileLayout(m) {
    const key = [
      m.points && m.points.length, m.tile_w_px, m.tile_h_px, m.grout_px,
      m.angle, m.pattern,
      m.points && m.points.length ? `${m.points[0]}|${m.points[m.points.length - 1]}` : '',
      m.grid_origin,
    ].join(',');
    this._tileMemo ??= new Map();
    const hit = this._tileMemo.get(m._uid);
    if (hit && hit.key === key) return hit.layout;
    const layout = tilesFor(m, { cap: TILE_DRAW_CAP });
    this._tileMemo.set(m._uid, { key, layout });
    // A handful of tile items per sheet; a hard bound keeps this from growing
    // into a leak on a project with hundreds.
    if (this._tileMemo.size > 64) {
      this._tileMemo.delete(this._tileMemo.keys().next().value);
    }
    return layout;
  }

  _drawItemMarkers(ctx, m, ms) {
    const vp = this.viewport;
    const c = itemColor(m);
    const pts = m.points || [];
    const S = (p) => vp.toScreen(p[0], p[1]);

    switch (m.type) {
      case 'distance':
      // The desktop puts his own arrowheads on both of these; this renderer
      // has one endpoint mark and draws it on both, so the two types still
      // agree with each other here the way they do there.
      case 'ref_distance':
        if (pts.length >= 2) {
          for (const p of [pts[0], pts[1]]) {
            const [x, y] = S(p);
            drawEndpointDot(ctx, x, y, [c[0], c[1], c[2], 1], 4.0, ms);
          }
        }
        break;
      case 'pitch':
        if (pts.length >= 2) {
          for (const p of [pts[0], pts[1]]) {
            const [x, y] = S(p);
            drawEndpointDot(ctx, x, y, [c[0], c[1], c[2], 1], 4.0, ms);
          }
        }
        break;
      case 'polyline':
        for (const p of pts) {
          const [x, y] = S(p);
          drawEndpointDot(ctx, x, y, [c[0], c[1], c[2], 1], 4.0, ms);
        }
        break;
      case 'count':
        for (const p of pts) {
          const [x, y] = S(p);
          drawCountMarker(ctx, x, y, c, 8.0, ms);
        }
        break;
      case 'window':
        for (const p of pts) {
          const [x, y] = S(p);
          drawWindowMarker(ctx, x, y, c, 9.0, ms);
        }
        break;
      case 'door':
        for (const p of pts) {
          const [x, y] = S(p);
          drawDoorMarker(ctx, x, y, c, 9.0, ms);
        }
        break;
      case 'linear_count':
        for (const p of generatedPoints(m)) {
          const [x, y] = S(p);
          drawCountMarker(ctx, x, y, c, 6.0, ms);
        }
        break;
      default:
        break;
    }
  }

  _drawSelection(ctx, m) {
    const pts = m.points || [];
    // The desktop outlines a strict list and nothing else. A count is one item
    // with many bubbles, so tracing its points drew a line zig-zagging across
    // the whole sheet joining every one of them in click order.
    if (!SELECTION_OUTLINE_TYPES.has(m.type)) return;
    const w = 1.5 / this.viewport.zoom;
    ctx.lineWidth = w;
    ctx.strokeStyle = MARKS.selection;
    if (isAreaType(m.type) && pts.length >= 3) {
      ctx.beginPath(); tracePath(ctx, pts, true); ctx.stroke();
      if (m.type === 'grid' || m.type === 'tile') {
        ctx.lineWidth = 3.5 / this.viewport.zoom;
        ctx.strokeStyle = MARKS.selectionGlow;
        ctx.beginPath(); tracePath(ctx, pts, true); ctx.stroke();
      }
    } else if (pts.length >= 2) {
      ctx.beginPath(); tracePath(ctx, pts, false); ctx.stroke();
    }
  }

  _drawHover(ctx, m) {
    const pts = m.points || [];
    if (!pts.length) return;
    if (!SELECTION_OUTLINE_TYPES.has(m.type)) return;
    ctx.lineWidth = 2.0 / this.viewport.zoom;
    ctx.strokeStyle = MARKS.hover;
    ctx.beginPath();
    tracePath(ctx, pts, isAreaType(m.type));
    ctx.stroke();
  }

  _drawHandles(ctx, m, f) {
    const vp = this.viewport;
    const pts = m.points || [];
    // A count item's points are its bubbles; handles on top of them would be
    // unreadable, so only shapes with an editable outline get vertex grips.
    if (['count', 'window', 'door'].includes(m.type)) return;
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = vp.toScreen(pts[i][0], pts[i][1]);
      const state = f.dragVertex && f.dragVertex.id === m._uid && f.dragVertex.index === i
        ? 'drag'
        : f.hoverVertex && f.hoverVertex.id === m._uid && f.hoverVertex.index === i
          ? 'hover' : 'idle';
      drawVertexHandle(ctx, x, y, { state, uiScale: this.uiScale });
    }
  }

  _drawMarquee(ctx, rect) {
    const vp = this.viewport;
    const [x0, y0] = vp.toScreen(rect.x, rect.y);
    const [x1, y1] = vp.toScreen(rect.x + rect.w, rect.y + rect.h);
    ctx.save();
    ctx.lineWidth = 1.4;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = MARKS.selectionStrong;
    ctx.fillStyle = 'rgba(71,114,179,0.12)';
    const x = Math.min(x0, x1), y = Math.min(y0, y1);
    const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }

  // ── labels ──────────────────────────────────────────────────────────

  _drawItemLabel(ctx, m, ms) {
    const vp = this.viewport;
    const c = itemColor(m);
    const rgb = [
      Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255),
    ];
    const pts = m.points || [];
    if (!pts.length) return;
    const notesHint = m.notes ? ' [N]' : '';
    const tag = shapeTag(m);
    const name = String(m.name || '').trim();
    const nameLine = name ? `${name}\n` : '';

    switch (m.type) {
      case 'count': {
        const num = m.count_number;
        if (num == null) break;
        for (const p of pts) {
          const [x, y] = vp.toScreen(p[0], p[1]);
          drawLabel(ctx, String(num), x, y, rgb, {
            circle: true, markerScale: ms, alpha: 236,
          });
        }
        break;
      }
      case 'window':
      case 'door': {
        const pre = m.type === 'window' ? 'win_' : 'door_';
        const seq = m[pre + 'seq'] ?? '';
        const tagText = m[pre + 'number'] || '';
        const wt = m[pre + 'width'] || '';
        const ht = m[pre + 'height'] || '';
        const dims = (wt || ht) ? `${wt} × ${ht}`.replace(/^ ×|× $/g, '').trim() : '';
        const [x, y] = vp.toScreen(pts[0][0], pts[0][1]);
        // A tag ALONE is enough for the detailed chip — that is where the notes
        // marker lives, and dropping it hid every note on a tagged opening.
        if (tagText || wt || ht) {
          const line1 = tagText || `#${seq || 1}`;
          const text = dims ? `${line1}\n${dims}${notesHint}` : `${line1}${notesHint}`;
          drawLabel(ctx, text, x, y - 26 * ms, rgb, { alpha: 220 });
        } else {
          drawLabel(ctx, String(seq || 1), x, y - 22 * ms, rgb, {
            circle: true, markerScale: ms, alpha: 220,
          });
        }
        break;
      }
      case 'page_ref': {
        const [x, y] = vp.toScreen(pts[0][0], pts[0][1]);
        const r = calloutRadius({
          mode: this.calloutMode, inches: this.calloutInches,
          dpi: this.pageDpi, zoom: vp.zoom, markerScale: ms,
        });
        if (m.arrow && m.arrow.length >= 2) {
          const [ax, ay] = vp.toScreen(m.arrow[0], m.arrow[1]);
          drawCalloutLeader(ctx, x, y, r, ax, ay, c);
        }
        const parts = calloutParts(m);
        drawCallout(ctx, x, y, r, parts.detail, parts.sheet, c, {
          fill: this.calloutFill,
          selected: this._selectedNow ? this._selectedNow.has(m._uid) : false,
        });
        break;
      }
      case 'textnote': {
        const anchor = pts.length >= 2 ? pts[1] : pts[0];
        const [bx, by] = vp.toScreen(anchor[0], anchor[1]);
        const box = drawNote(ctx, String(m.text || ''), bx, by, rgb, {
          fontSize: Number(m.font_size) || 12,
        });
        if (pts.length >= 2) {
          const [tx, ty] = vp.toScreen(pts[0][0], pts[0][1]);
          const [ex, ey] = noteArrowBorder(bx, by, box.w / 2, box.h / 2, tx, ty);
          drawNoteLeader(ctx, tx, ty, ex, ey, rgba(c, 0.9));
        }
        break;
      }
      default: {
        const text = this._labelTextFor(m, notesHint, tag, nameLine);
        if (!text) break;
        const anchor = labelAnchorFor(m);
        const [x, y] = vp.toScreen(anchor[0], anchor[1]);
        drawLabel(ctx, text, x, y, rgb, {
          alpha: 220,
          header: m.type === 'pitch' ? 'Pitch / Angle'
            : m.type === 'ref_distance' ? REF_DIST_CAPTION
              : null,
        });
      }
    }
  }

  _labelTextFor(m, notesHint, tag, nameLine) {
    const own = shapeOwn(m);
    switch (m.type) {
      case 'distance': {
        const txt = formatDistancePrecision(own.value, m.precision || '1/2');
        return nameLine ? `${nameLine}${txt}${notesHint}${tag}` : `${txt}${notesHint}${tag}`;
      }
      case 'ref_distance': {
        // The distance AND the scale it was read at, in one box, in the
        // desktop's words and with its separator. A reference measurement
        // whose scale is invisible is the trap this item exists to close —
        // and a phone that showed the length alone would reopen it on a
        // second screen. No name, no notes hint, no shape tag: it has none
        // of those, and _labelTextFor's other cases take them as arguments
        // precisely because every other type does.
        const txt = formatDistancePrecision(own.value, m.precision || '1/2');
        return `${txt}   ·   ${refScaleWords(m, this.pageDpi)}`;
      }
      case 'pitch': {
        // The desktop stores rise-per-12 in `value`; only slope_area has a
        // `pitch` key. Reading `pitch` here made every desktop-authored pitch
        // render as "0:12" beside a correct angle.
        const p = Number(m.value ?? m.pitch) || 0;
        const ang = Number(m.angle_deg) || (Math.atan2(p, 12) * 180) / Math.PI;
        return `${nameLine}${pitchLabel(p)}   ${ang.toFixed(0)}°${notesHint}`;
      }
      case 'area':
        return `${nameLine}${own.value.toFixed(1)} sq ft${notesHint}${tag}`;
      case 'slope_area':
        return `${nameLine}${own.value.toFixed(1)} sq ft (${g(m.pitch || 0)}:12)${notesHint}${tag}` +
               `\nFlat: ${(own.flat || 0).toFixed(1)} sq ft`;
      case 'polyline':
        return `${nameLine}${formatFt(own.value)}${notesHint}${tag}`;
      case 'linear_count':
        return `${nameLine}${Math.trunc(own.value)} items @ ${g(m.spacing_in ?? 12)}"${notesHint}${tag}`;
      case 'grid': {
        const cols = Math.max(1, Number(m.cols) || 1);
        const rows = Math.max(1, Number(m.rows) || 1);
        const l1 = m.name || m.label || `Grid ${cols}×${rows}`;
        const l2 = `${cols}×${rows} cells  (${g2(m.cell_w_ft)}×${g2(m.cell_h_ft)} ft each)`;
        const l3 = `Total ${(own.value || 0).toFixed(0)} sq ft${notesHint}`;
        return `${l1}\n${l2}\n${l3}`;
      }
      case 'tile': {
        const pat = tilePatternLabel(m.pattern || 'grid');
        const l1 = m.name || m.label || `Tile — ${pat}`;
        const count = Number(m.tile_count) || 0;
        const needed = Number(m.tiles_needed) || 0;
        const l2 = `${count.toLocaleString('en-US')} tiles  (${g(m.tile_w_in ?? 12)}″×${g(m.tile_h_in ?? 12)}″ ${pat})`;
        const l3 = `+${g(m.waste_pct || 0)}% waste → ${needed.toLocaleString('en-US')} tiles`;
        let l4 = `Total ${(own.value || 0).toFixed(0)} sq ft${notesHint}`;
        if (m.boxes) l4 += `  ·  ${m.boxes} boxes`;
        return `${l1}\n${l2}\n${l3}\n${l4}`;
      }
      default:
        return '';
    }
  }

  // ── the live tool preview ───────────────────────────────────────────

  _drawPreview(ctx, pv, ppf, ms) {
    const vp = this.viewport;
    const mode = pv.mode;
    const pts = pv.points || [];
    const cursor = pv.constrained || pv.cursor;
    const col = PREVIEW_COLORS[mode] || [0, 1, 1, 0.7];
    const S = p => vp.toScreen(p[0], p[1]);

    if (mode === 'distance' || mode === 'calibrate') {
      if (pts.length >= 1 && cursor) {
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = rgba(col, 0.7);
        ctx.beginPath();
        const [x0, y0] = S(pts[0]); const [x1, y1] = S(cursor);
        ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        drawEndpointDot(ctx, x0, y0, [0, 1, 1, 1], 4.0, ms);
      }
      return;
    }

    if (mode === 'pitch') {
      if (pts.length >= 1 && cursor) {
        const [sx, sy] = S(pts[0]); const [ex, ey] = S(cursor);
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(102,179,255,0.5)';
        ctx.beginPath();
        ctx.moveTo(sx, sy); ctx.lineTo(ex, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = 'rgba(102,179,255,0.85)';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        drawEndpointDot(ctx, sx, sy, [0.4, 0.7, 1, 1], 4.0, ms);
      }
      return;
    }

    if (mode === 'area' || mode === 'slope_area' || mode === 'grid' || mode === 'tile') {
      this._drawPolygonPreview(ctx, pts, cursor, col, pv, ms);
      return;
    }

    if (mode === 'polyline') {
      if (pts.length >= 1) {
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = rgba(col, 0.7);
        ctx.beginPath();
        pts.forEach((p, i) => {
          const [x, y] = S(p);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        if (cursor) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = rgba(col, 0.55);
          ctx.beginPath();
          const [lx, ly] = S(pts[pts.length - 1]); const [cx, cy] = S(cursor);
          ctx.moveTo(lx, ly); ctx.lineTo(cx, cy); ctx.stroke();
        }
        for (const p of pts) {
          const [x, y] = S(p);
          drawEndpointDot(ctx, x, y, [1, 0.55, 0, 1], 4.0, ms);
        }
      }
      return;
    }

    if (mode === 'linear_count') {
      const chain = cursor ? [...pts, cursor] : pts;
      if (chain.length >= 2) {
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = 'rgba(77,230,255,0.75)';
        ctx.beginPath();
        chain.forEach((p, i) => {
          const [x, y] = S(p);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        const spacingPx = ((Number(pv.spacingIn) || 12) / 12) * ppf;
        if (spacingPx > 1) {
          for (const p of pointsAlongPath(chain, spacingPx)) {
            const [x, y] = S(p);
            drawCountMarker(ctx, x, y, [0.3, 0.9, 1, 1], 5.0, ms);
          }
        }
      }
      for (const p of pts) {
        const [x, y] = S(p);
        drawEndpointDot(ctx, x, y, [0.3, 0.9, 1, 1], 4.0, ms);
      }
      return;
    }
  }

  _drawPolygonPreview(ctx, pts, cursor, col, pv, ms) {
    const vp = this.viewport;
    const S = p => vp.toScreen(p[0], p[1]);
    const target = cursor;
    const preview = target ? [...pts, target] : pts;

    if (preview.length >= 3) {
      ctx.save();
      ctx.beginPath();
      preview.forEach((p, i) => {
        const [x, y] = S(p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = rgba(col, 0.14);
      ctx.fill('evenodd');
      ctx.restore();
    }

    if (pts.length >= 2) {
      ctx.lineWidth = 2.0;
      ctx.strokeStyle = rgba(col, 0.8);
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = S(p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    if (target && pts.length >= 1) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(col, 0.5);
      ctx.beginPath();
      const [lx, ly] = S(pts[pts.length - 1]);
      const [tx, ty] = S(target);
      ctx.moveTo(lx, ly); ctx.lineTo(tx, ty);
      if (pts.length >= 2) {
        const [fx, fy] = S(pts[0]);
        ctx.lineTo(fx, fy);
      }
      ctx.stroke();
    }

    for (const p of pts) {
      const [x, y] = S(p);
      drawEndpointDot(ctx, x, y, [col[0], col[1], col[2], 1], 4.0, ms);
    }

    // The snap-to-first halo: closing the outline is a click on its own point,
    // and the halo is what tells the user the click will close rather than add.
    if (pv.snapToFirst && pts.length >= 3) {
      const [x, y] = S(pts[0]);
      drawEndpointDot(ctx, x, y, [1, 1, 1, 0.4], 12.0, 1);
      drawEndpointDot(ctx, x, y, [col[0], col[1], col[2], 1], 6.0, 1);
    }
    if (pv.constrained && target) {
      const [x, y] = S(target);
      drawEndpointDot(ctx, x, y, [1, 1, 0.4, 0.9], 5.0, 1);
    }
  }

  _drawPreviewLabel(ctx, pv, ppf) {
    const vp = this.viewport;
    const mode = pv.mode;
    const pts = pv.points || [];
    const cursor = pv.constrained || pv.cursor;
    const rgb = PREVIEW_LABEL_RGB[mode];
    if (!rgb || !pts.length) return;

    let text = '';
    let anchor = pts[pts.length - 1];
    let header = null;
    let alpha = 160;

    if (mode === 'pitch' && cursor) {
      const dx = Math.abs(cursor[0] - pts[0][0]);
      const dy = Math.abs(cursor[1] - pts[0][1]);
      const r12 = dx < 1e-6 ? Infinity : (dy / dx) * 12;
      const ang = (Math.atan2(dy, dx || 1e-9) * 180) / Math.PI;
      text = `${Number.isFinite(r12) ? g(Math.round(r12 * 4) / 4) : '—'}:12  ${ang.toFixed(0)}°`;
      header = 'Pitch / Angle';
      alpha = 170;
      anchor = mid(pts[0], cursor);
    } else if (mode === 'distance' && cursor) {
      text = formatFt(Math.hypot(cursor[0] - pts[0][0], cursor[1] - pts[0][1]) / ppf);
      anchor = mid(pts[0], cursor);
    } else if (mode === 'calibrate' && cursor) {
      text = `${Math.hypot(cursor[0] - pts[0][0], cursor[1] - pts[0][1]).toFixed(0)}px`;
      anchor = mid(pts[0], cursor);
    } else if (mode === 'area' || mode === 'slope_area' || mode === 'tile') {
      const poly = cursor ? [...pts, cursor] : pts;
      if (poly.length >= 3 && ppf > 0) {
        const sf = polygonArea(poly) / (ppf * ppf);
        text = `~${sf.toFixed(1)} sq ft`;
        if (mode === 'tile') {
          const tw = (Number(pv.tileWIn) || 12) + (Number(pv.groutIn) || 0);
          const th = (Number(pv.tileHIn) || 12) + (Number(pv.groutIn) || 0);
          const tileArea = (tw * th) / 144;
          if (tileArea > 0) {
            text += `  ·  ~${Math.ceil(sf / tileArea).toLocaleString('en-US')} tiles`;
          }
        }
      } else {
        text = `~${formatFt(pathLength(poly) / (ppf || 1))}`;
      }
    } else if (mode === 'polyline') {
      const chain = cursor ? [...pts, cursor] : pts;
      text = `~${formatFt(pathLength(chain) / (ppf || 1))}`;
    } else if (mode === 'linear_count') {
      const chain = cursor ? [...pts, cursor] : pts;
      const spacingPx = ((Number(pv.spacingIn) || 12) / 12) * ppf;
      const n = spacingPx > 1 ? pointsAlongPath(chain, spacingPx).length : chain.length;
      text = `~${n} items`;
    }

    if (!text) return;
    const [x, y] = vp.toScreen(anchor[0], anchor[1]);
    drawLabel(ctx, text, x, y, rgb, { alpha, header });
  }

  /**
   * The markup being drawn right now.
   *
   * Drawn in SCREEN space, unlike the committed strokes: a stroke in progress
   * is a gesture, and it should track the cursor exactly rather than through
   * the world transform.
   */
  _drawMarkupPreview(ctx, mk) {
    const vp = this.viewport;
    const S = p => vp.toScreen(p[0], p[1]);

    if (mk.stroke && mk.stroke.points.length) {
      const pts = mk.stroke.points;
      ctx.save();
      ctx.lineWidth = Math.max(mk.stroke.width * vp.zoom, 1);
      ctx.strokeStyle = rgba(mk.stroke.color);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = S(p);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (pts.length === 1) {
        // A press with no movement yet still shows where the nib is.
        const [x, y] = S(pts[0]);
        ctx.lineTo(x + 0.01, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (mk.rect) {
      const [x0, y0] = S([mk.rect.a[0], mk.rect.a[1]]);
      const [x1, y1] = S([mk.rect.b[0], mk.rect.b[1]]);
      ctx.save();
      ctx.fillStyle = rgba(mk.rectColor || [1, 1, 0, 0.4]);
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.restore();
    }

    if (mk.eraser) {
      const [x, y] = S(mk.eraser);
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = MARKS.eraser;
      ctx.beginPath();
      ctx.arc(x, y, mk.eraserRadius || 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (mk.noteTip && mk.noteCur) {
      const [tx, ty] = S(mk.noteTip);
      const [cx, cy] = S(mk.noteCur);
      ctx.save();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = MARKS.textnoteDrag;
      ctx.beginPath();
      ctx.moveTo(tx, ty); ctx.lineTo(cx, cy);
      ctx.stroke();
      drawEndpointDot(ctx, tx, ty, [1, 0.9, 0.3, 1], 5.0, 1);
      drawEndpointDot(ctx, cx, cy, [1, 0.9, 0.3, 0.5], 4.0, 1);
      ctx.restore();
    }
  }

  // ── markup ──────────────────────────────────────────────────────────

  /**
   * Markup: freehand strokes and box highlights.
   *
   * A DENYLIST, not an allowlist — the desktop returns only on CAD and treats
   * anything else as freehand. An allowlist made box highlights invisible and
   * would have dropped any stroke written without a subtype.
   */
  _drawAnnotation(ctx, a) {
    if (a.visible === false) return;      // the user hid it; keep it hidden
    if (a.subtype === 'cad') return;      // the CAD pass is not built yet
    const z = this.viewport.zoom;
    const pts = a.points || [];
    // The alpha IS the colour's fourth channel. Overriding it to 1 painted
    // every highlighter stroke solid over the linework it was meant to lift.
    const color = a.color || [1, 0.2, 0.2, 1];

    if (a.subtype === 'rect') {
      if (pts.length < 2) return;
      const x0 = Math.min(pts[0][0], pts[1][0]), x1 = Math.max(pts[0][0], pts[1][0]);
      const y0 = Math.min(pts[0][1], pts[1][1]), y1 = Math.max(pts[0][1], pts[1][1]);
      ctx.fillStyle = rgba(color);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      return;
    }

    if (pts.length < 2) return;
    ctx.lineWidth = Math.max((Number(a.width) || 3) * z, 1.0) / z;
    ctx.strokeStyle = rgba(color);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    tracePath(ctx, pts, false);
    ctx.stroke();
  }
}

// ── helpers ───────────────────────────────────────────────────────────────

function tracePath(ctx, pts, close) {
  pts.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  });
  if (close) ctx.closePath();
}

function traceQuad(ctx, quad) {
  quad.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
  });
  ctx.closePath();
}

function mid(a, b) { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }

function g(v, dp = 6) {
  return String(parseFloat((Number(v) || 0).toPrecision(dp)));
}
function g2(v) {
  return String(parseFloat((Number(v) || 0).toPrecision(2)));
}

/**
 * A shape's OWN numbers, not its item's total.
 *
 * A multi-shape item keeps the running total on its first shape so the side
 * panel can show one number per item. On the drawing that made shape 1 look
 * as if it had swallowed the others — 160 and 38 reading as 198 and 38.
 */
function shapeOwn(m) {
  if (m.group_id && !m.group_child) {
    return {
      value: Number(m.own_value ?? m.value) || 0,
      perimeter: Number(m.own_perimeter ?? m.perimeter) || 0,
      flat: Number(m.own_flat ?? m.flat_area) || 0,
    };
  }
  return {
    value: Number(m.value) || 0,
    perimeter: Number(m.perimeter) || 0,
    flat: Number(m.flat_area) || 0,
  };
}

function shapeTag(m) {
  const n = Number(m.group_count) || 1;
  if (n <= 1 || !m.shape_no) return '';
  return `  ·  ${m.shape_no} of ${n}`;
}

function labelAnchorFor(m) {
  const pts = m.points || [];
  if (!pts.length) return [0, 0];
  if (isAreaType(m.type)) return areaCentroid(pts);
  // The midpoint, which is where the desktop puts all three. The fallback
  // below picks pts[length / 2] — on a two-point line that is the far END,
  // so the read-out would hang off the tip of the line instead of sitting on
  // it.
  if (m.type === 'distance' || m.type === 'pitch' || m.type === 'ref_distance') {
    return pts.length >= 2 ? mid(pts[0], pts[1]) : pts[0];
  }
  return pts[Math.floor(pts.length / 2)];
}

export { shapeOwn, shapeTag, labelAnchorFor };

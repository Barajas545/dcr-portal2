// measure.js — what an item measures, and how it reads.
//
// Every takeoff item carries a stored `value`: the one number the estimate
// sums. This module is the only place that number is derived from geometry,
// and the only place it is turned into text, so no two readers can drift.
//
// The ppf used is ALWAYS the item's own stamp. See units.js for why.

import {
  pathLength, perimeter, polygonArea, pointsAlongPath, gridForPolygon,
  tileLayout, TILE_COUNT_CAP, slopeFactor, selfIntersects, areaCentroid,
  centroid, boundingBox,
} from './geom.js';
import {
  itemPpf, formatQty, formatFt, formatDistancePrecision, DEFAULT_PPF,
} from './units.js';

/**
 * What each item type measures, and the unit its value is in.
 *
 * These unit STRINGS are the ones the reports print, character for character,
 * so a takeoff exported here and one exported from the desktop app can be put
 * side by side. Do not tidy "sq ft" into "SF".
 */
export const ITEM_MEASURE = {
  area:         { unit: 'sq ft', kind: 'area',   closed: true },
  slope_area:   { unit: 'sq ft', kind: 'area',   closed: true },
  grid:         { unit: 'sq ft', kind: 'area',   closed: true },
  tile:         { unit: 'sq ft', kind: 'area',   closed: true },
  polyline:     { unit: 'LF',    kind: 'length', closed: false },
  distance:     { unit: 'LF',    kind: 'length', closed: false },
  linear_count: { unit: 'EA',    kind: 'count',  closed: false },
  count:        { unit: 'EA',    kind: 'count',  closed: false },
  window:       { unit: 'EA',    kind: 'count',  closed: false },
  door:         { unit: 'EA',    kind: 'count',  closed: false },
  pitch:        { unit: '',      kind: 'ratio',  closed: false },
  standalone:   { unit: '',      kind: 'manual', closed: false },
};

/**
 * The (qty, unit) pair every report and export uses for an item.
 * Matches the desktop report builder exactly, including the special cases:
 * a count is the number of POINTS, and an opening always counts as one.
 */
export function reportQty(m) {
  const t = m.type;
  if (t === 'standalone') {
    return { qty: Number(m.qty) || 0, unit: String(m.unit || 'each') };
  }
  if (t === 'count') return { qty: (m.points || []).length, unit: 'EA' };
  if (t === 'linear_count') return { qty: Math.trunc(Number(m.value) || 0), unit: 'EA' };
  if (t === 'window' || t === 'door') return { qty: 1, unit: 'EA' };
  const spec = ITEM_MEASURE[t];
  if (!spec || !spec.unit) return null;
  return { qty: Number(m.value) || 0, unit: spec.unit };
}

export function isAreaType(type) { return ITEM_MEASURE[type]?.kind === 'area'; }
export function isClosed(type) { return !!ITEM_MEASURE[type]?.closed; }

/**
 * The quantity an item's geometry works out to, in the type's own unit.
 *
 * Returns the value only. Side fields a type also needs (flat_area on a slope,
 * tiles_needed on a tile run) come back from recompute below.
 */
export function computeValue(item) {
  const ppf = itemPpf(item, DEFAULT_PPF);
  const pts = item.points || [];
  switch (item.type) {
    case 'area':
    case 'grid':
      return polygonArea(pts) / (ppf * ppf);

    case 'tile':
      return polygonArea(pts) / (ppf * ppf);

    case 'slope_area': {
      const flat = polygonArea(pts) / (ppf * ppf);
      // The default pitch is 4:12, not flat. `|| 0` billed a roof with no
      // stored pitch as though it had none — a 5.4% shortfall on the area.
      return flat * slopeFactor(item.pitch ?? 4);
    }

    case 'polyline':
    case 'distance':
    // At ITS OWN ppf, which itemPpf has already read off the item above.
    // Without this case a dragged reference line kept the length it used to
    // have — which is word for word why the desktop's _recalc_measurement
    // had to grow a branch of its own for this type.
    case 'ref_distance':
      return pathLength(pts) / ppf;

    case 'linear_count': {
      const spacingFt = (Number(item.spacing_in) || 12) / 12;
      const spacingPx = spacingFt * ppf;
      return pointsAlongPath(pts, spacingPx).length;
    }

    case 'count':
    case 'window':
    case 'door':
      return pts.length;

    case 'standalone':
      return Number(item.qty) || 0;

    default:
      return Number(item.value) || 0;
  }
}

/** True for the first shape of a multi-shape item — the one that holds the total. */
export function isGroupMaster(item) {
  return !!item.group_id && !item.group_child;
}

/**
 * A shape's OWN metrics, as opposed to its item's total.
 *
 * A multi-shape item keeps the running total of every shape on its master, and
 * the master's own figures in own_value / own_perimeter / own_flat /
 * own_total_ft. Anything that reasons about the MASTER'S GEOMETRY — a label, a
 * scale recovery, a recompute — has to read these, or it will divide one
 * shape's pixels by three shapes' feet.
 */
export function shapeOwn(m) {
  if (isGroupMaster(m)) {
    return {
      value: Number(m.own_value ?? m.value) || 0,
      perimeter: Number(m.own_perimeter ?? m.perimeter) || 0,
      flat: Number(m.own_flat ?? m.flat_area) || 0,
      totalFt: Number(m.own_total_ft ?? m.total_ft) || 0,
    };
  }
  return {
    value: Number(m.value) || 0,
    perimeter: Number(m.perimeter) || 0,
    flat: Number(m.flat_area) || 0,
    totalFt: Number(m.total_ft) || 0,
  };
}

/**
 * Recompute every derived field on an item after its geometry or options
 * change. Mutates and returns the item.
 *
 * ON A GROUP MASTER this writes own_* and leaves the aggregate alone. The
 * master's `value` is the sum over every shape in the item; deriving it from
 * the master's own points destroyed the other shapes' contribution — a 320 LF
 * three-shape wall came back as 110 LF after nudging one vertex, and the loss
 * was written straight to the file.
 */
export function recompute(item) {
  const ppf = itemPpf(item, DEFAULT_PPF);
  const pts = item.points || [];
  const master = isGroupMaster(item);
  // On a master, the delta between the old own-value and the new one moves the
  // aggregate with it. That keeps the total right without needing the sibling
  // shapes, which live in the same page bucket but are not reachable here.
  const prevOwn = shapeOwn(item);

  const ownValue = computeValue(item);
  if (master) {
    item.own_value = ownValue;
    item.value = (Number(item.value) || 0) + (ownValue - prevOwn.value);
  } else {
    item.value = ownValue;
  }

  if (isAreaType(item.type)) {
    const per = perimeter(pts) / ppf;
    if (master) {
      item.own_perimeter = per;
      item.perimeter = (Number(item.perimeter) || 0) + (per - prevOwn.perimeter);
    } else {
      item.perimeter = per;
    }
    // A crossed outline reads as a small or even zero area under the shoelace
    // formula. Flag it so nothing downstream totals a number nobody drew.
    item.self_intersects = selfIntersects(pts);
  }

  if (item.type === 'slope_area') {
    const flat = polygonArea(pts) / (ppf * ppf);
    if (master) {
      item.own_flat = flat;
      item.flat_area = (Number(item.flat_area) || 0) + (flat - prevOwn.flat);
    } else {
      item.flat_area = flat;
    }
  }

  if (item.type === 'grid') {
    const cw = Number(item.cell_w_px) || 0;
    const ch = Number(item.cell_h_px) || 0;
    if (cw > 0 && ch > 0) {
      item.cell_w_ft = cw / ppf;
      item.cell_h_ft = ch / ppf;
      // cols and rows span the traced outline's own rotated bounding box.
      // Reading two of its corners as though they were opposite ends of a
      // rectangle is what used to overwrite the right answer with a wrong one.
      const g = gridForPolygon(pts, cw, ch, Number(item.angle) || 0, {
        anchor: item.grid_origin || pts[0],
      });
      item.cols = g.cols;
      item.rows = g.rows;
      // NOT group_count. That is the number of SHAPES in a multi-shape item,
      // read by both apps' labels, reports and delete confirmations — writing
      // a cell count there made a grid announce "total of 25 shapes", and on a
      // real multi-shape item it destroyed the true count.
      item.cell_count = g.cols * g.rows;
    }
  }

  if (item.type === 'tile') {
    // Reader defaults come from _tile_compute (pdf_fast_viewer.py:20429):
    // grout 1/16 inch and waste 10%, NOT zero. `|| 0` dropped the entire waste
    // allowance on any file that did not carry the keys — hundreds of tiles
    // missing from a purchase order. `??` so an explicit 0 is still honoured.
    const tw = ((Number(item.tile_w_in) ?? 12) / 12) * ppf;
    const th = ((Number(item.tile_h_in) ?? 12) / 12) * ppf;
    const groutIn = Number(item.grout_in ?? 0.0625);
    const grout = (groutIn / 12) * ppf;
    item.tile_w_px = tw;
    item.tile_h_px = th;
    item.grout_px = grout;
    if (pts.length >= 3 && tw > 0 && th > 0) {
      const layout = tileLayout(pts, {
        anchor: item.grid_origin || pts[0],
        tileW: tw, tileH: th, grout,
        angleDeg: Number(item.angle) || 0,
        pattern: item.pattern || 'grid',
      });
      item.tile_count = layout.count;
      item.count_capped = layout.capped;
      const waste = Number(item.waste_pct ?? 10);
      item.tiles_needed = Math.ceil(layout.count * (1 + waste / 100));
      const per = Number(item.tiles_per_box) || 0;
      item.boxes = per > 0 ? Math.ceil(item.tiles_needed / per) : 0;
      // Grout joints repeat at the PITCH — tile plus joint — so a square foot
      // of floor carries 1/(w+g) + 1/(h+g) linear feet of joint.
      const pwFt = (Number(item.tile_w_in ?? 12) + groutIn) / 12;
      const phFt = (Number(item.tile_h_in ?? 12) + groutIn) / 12;
      if (pwFt > 0 && phFt > 0) {
        item.grout_lf = (Number(item.value) || 0) * (1 / pwFt + 1 / phFt);
      }
    }
  }

  refreshLabel(item);

  if (item.type === 'linear_count') {
    // total_ft is what recoverPpf inverts on the next open. Leaving it stale
    // while the geometry changed made the recovered scale wrong — and the
    // wrong scale then re-spaced the array, turning 31 studs into 16.
    const ft = pathLength(pts) / ppf;
    if (master) {
      item.own_total_ft = ft;
      item.total_ft = (Number(item.total_ft) || 0) + (ft - prevOwn.totalFt);
    } else {
      item.total_ft = ft;
    }
    item.dot_count = ownValue;
  }

  return item;
}

/**
 * Rewrite an item's on-canvas caption after its geometry changed.
 *
 * A named item keeps its name. An unnamed one is captioned with its own
 * quantity, and leaving that stale meant a reshaped area still called itself
 * "243.5 sq ft" in every report while its quantity column read 500.
 */
export function refreshLabel(item) {
  const name = String(item.name || '').trim();
  if (name) { item.label = name; return item.label; }
  const own = shapeOwn(item);
  switch (item.type) {
    case 'area':
    case 'grid':
      item.label = `${own.value.toFixed(1)} sq ft`;
      break;
    case 'slope_area':
      item.label = `${own.value.toFixed(1)} sq ft (${trimNum(item.pitch ?? 4)}:12)`;
      break;
    case 'tile':
      item.label = `Tile ${(Number(item.tile_count) || 0).toLocaleString('en-US')} ` +
                   `(${tilePatternLabel(item.pattern || 'grid')})`;
      break;
    case 'polyline':
      item.label = formatFt(own.value);
      break;
    case 'linear_count':
      item.label = `${Math.trunc(own.value)} items`;
      break;
    case 'ref_distance':
      // To the half inch, not formatFt's whole inch: what this type measures
      // is a DETAIL, where the half inch is the reason he zoomed in on it.
      // The desktop writes this same string into `label`, so a line dragged
      // here and reopened there does not read two different lengths.
      item.label = formatDistancePrecision(own.value, item.precision || '1/2');
      break;
    default:
      break;   // distance recomputes live; count/window/door keep their names
  }
  return item.label;
}

function trimNum(v, dp = 6) {
  return String(parseFloat((Number(v) || 0).toPrecision(dp)));
}

/** The grid cells an item draws, derived not stored. */
export function gridCellsFor(item) {
  if (item.type !== 'grid') return null;
  const pts = item.points || [];
  if (pts.length < 2) return null;
  return gridForPolygon(
    pts,
    Number(item.cell_w_px) || 0,
    Number(item.cell_h_px) || 0,
    Number(item.angle) || 0,
    // The pattern starts at the anchor the estimator clicked, not at the
    // bounding-box corner — otherwise a grid aligned to a joist run in the
    // desktop app lands half a cell off in the browser.
    { anchor: item.grid_origin || pts[0] }
  );
}

/** The array dots an item draws, derived not stored. */
export function generatedPoints(item) {
  const ppf = itemPpf(item, DEFAULT_PPF);
  const pts = item.points || [];
  if (item.type === 'linear_count') {
    const spacingPx = ((Number(item.spacing_in) || 12) / 12) * ppf;
    return pointsAlongPath(pts, spacingPx);
  }
  return [];
}

/**
 * The tile run an item describes, derived not stored.
 *
 * `cap` differs by purpose. COUNTING tolerates 60,000 because the number goes
 * on a purchase order. DRAWING stops at 5,000: past that the joints are closer
 * than a screen pixel, and outlining 55,000 quads took 59 ms per frame — the
 * drag stopped tracking the cursor.
 */
export function tilesFor(item, { cap = TILE_COUNT_CAP } = {}) {
  if (item.type !== 'tile') return null;
  const pts = item.points || [];
  if (pts.length < 3) return null;
  return tileLayout(pts, {
    cap,
    anchor: item.grid_origin || pts[0],
    tileW: Number(item.tile_w_px) || 0,
    tileH: Number(item.tile_h_px) || 0,
    grout: Number(item.grout_px) || 0,
    angleDeg: Number(item.angle) || 0,
    pattern: item.pattern || 'grid',
  });
}

// ── how an item reads ─────────────────────────────────────────────────────

// The tile pattern labels, exactly as the desktop app writes them. These
// strings reach the items panel, the reports and the workbook, so the ½, ⅓ and
// ° are load-bearing, not decoration.
const TILE_PATTERN_LABELS = {
  grid: 'Straight Grid',
  half: 'Running Bond ½',
  third: 'Stair-Step ⅓',
  herringbone: 'Herringbone',
  chevron: 'Chevron',
  diagonal: 'Diagonal 45°',
};

export function tilePatternLabel(key) {
  return TILE_PATTERN_LABELS[key] || String(key || 'grid');
}

function g(v, dp = 6) {
  // Python's %g: the shortest form that round-trips at this precision.
  const n = Number(v) || 0;
  return String(parseFloat(n.toPrecision(dp)));
}

/**
 * The item's quantity line, exactly as the desktop panel writes it.
 * Empty string means the row shows no value line at all.
 */
export function valueString(m) {
  const type = m.type || '';

  if (type === 'standalone') {
    const q = Number(m.qty) || 0;
    const u = String(m.unit || 'each').trim();
    return q ? `${g(q)} ${u}` : 'no quantity yet — double-click to set';
  }

  const parts = [];
  // group_count is the number of SHAPES in the item. Never a cell or dot count.
  const nShapes = Number(m.group_count) || 1;
  if (nShapes > 1) parts.push(`total of ${nShapes} shapes`);
  const sc = String(m.scale || '').trim();
  if (sc) parts.push(`${sc} scale`);
  const suffix = parts.length ? `   ·  ${parts.join('  ·  ')}` : '';

  const v = Number(m.value) || 0;

  if (type === 'area' || type === 'grid') {
    return v ? `${v.toFixed(1)} sq ft${suffix}` : '';
  }
  if (type === 'slope_area') {
    return v ? `${v.toFixed(1)} sq ft (${g(m.pitch || 0)}:12)${suffix}` : '';
  }
  if (type === 'tile') {
    if (!v) return '';
    const needed = Math.trunc(Number(m.tiles_needed) || 0);
    const pat = tilePatternLabel(m.pattern || 'grid');
    let out = `${v.toFixed(1)} sq ft · ${needed.toLocaleString('en-US')} tiles (${pat})`;
    if (m.boxes) out += ` · ${m.boxes} boxes`;
    return out + suffix;
  }
  if (type === 'distance' || type === 'polyline') {
    return v ? `${v.toFixed(2)} ft${suffix}` : '';
  }
  if (type === 'window' || type === 'door') {
    const p = type === 'window' ? 'win_' : 'door_';
    const tag = m[p + 'number'] || '';
    const w = m[p + 'width'] || '';
    const h = m[p + 'height'] || '';
    if (w || h) return `${tag ? tag + '  ' : ''}${w} × ${h}`.trim();
    return tag || 'no size yet — double-click to edit';
  }
  if (type === 'linear_count') {
    const n = Math.trunc(v);
    const sp = m.spacing_in ?? 12;
    return `${n} items @ ${g(sp)}"${suffix}`;
  }
  if (type === 'count') {
    const cnt = (m.points || []).length;
    return cnt ? `× ${cnt}` : '';
  }
  return '';
}

/** The notes line with the purpose leading it. One helper, so nothing drifts. */
export function notesWithPurpose(m) {
  const notes = String(m.notes || '').trim();
  const purpose = String(m.purpose || '').trim();
  if (purpose) return notes ? `${purpose} — ${notes}` : purpose;
  return notes;
}

export function displayName(m) {
  return String(m.name || m.label || 'Unnamed').trim() || 'Unnamed';
}

/** The unit an item's value is expressed in. */
export function itemUnit(m) {
  if (m.type === 'standalone') return String(m.unit || 'each');
  return ITEM_MEASURE[m.type]?.unit || '';
}

// ── associated materials (assemblies) ─────────────────────────────────────
//
// An associated item is a material or labor line hung off a takeoff item.
// Its quantity is either a flat total or a rate per unit of the parent's
// measured value. The legacy field `qty_per` means per_unit.

export function assemblyTotal(ai, parentValue) {
  const qty = Number(ai.qty ?? ai.qty_per ?? 0) || 0;
  const mode = ai.qty_mode ?? (('qty_per' in ai && !('qty_mode' in ai)) ? 'per_unit' : 'total');
  return mode === 'total' ? qty : qty * (Number(parentValue) || 0);
}

export function assemblyCost(ai, parentValue) {
  return assemblyTotal(ai, parentValue) * (Number(ai.unit_cost ?? ai.price ?? 0) || 0);
}

/** Every associated line of an item, with its computed total and cost. */
export function expandAssembly(m) {
  const parentValue = Number(m.value) || 0;
  return (m.associated_items || []).map(ai => ({
    ...ai,
    total: assemblyTotal(ai, parentValue),
    cost: assemblyCost(ai, parentValue),
  }));
}

/** The item's own cost line, before its associated materials. */
export function itemCost(m) {
  return (Number(m.value) || 0) * (Number(m.unit_cost) || 0);
}

/** Item cost plus every associated line. */
export function itemTotalCost(m) {
  let total = itemCost(m);
  for (const line of expandAssembly(m)) total += line.cost;
  return total;
}

// ── labelling ─────────────────────────────────────────────────────────────

/** Where an item's read-out label belongs, in page space. */
export function labelAnchor(item) {
  const pts = item.points || [];
  if (!pts.length) return [0, 0];
  if (isAreaType(item.type)) return areaCentroid(pts);
  if (item.type === 'distance' && pts.length >= 2) {
    return [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
  }
  if (item.type === 'polyline') {
    // Midpoint of the run, so the label sits on the line rather than beside it.
    const total = pathLength(pts);
    let walked = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (walked + seg >= total / 2) {
        const t = seg > 0 ? (total / 2 - walked) / seg : 0;
        return [
          pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t,
          pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t,
        ];
      }
      walked += seg;
    }
  }
  return centroid(pts);
}

/** Page-space bounds of an item, for hit tests and ensureVisible. */
export function itemBounds(item) {
  return boundingBox(item.points || []);
}

export { formatQty };

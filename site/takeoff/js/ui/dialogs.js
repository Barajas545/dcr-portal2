// dialogs.js — every modal the app opens, as promises.
//
// Each function resolves with the value the user entered, or null if they
// cancelled. Cancelling must never be an exception: half the tools finalize by
// opening a form, and "the user changed their mind" is an ordinary outcome
// that has to leave the project untouched.

import { TAKEOFF_PALETTE, rgba, hex, fromHex } from '../render/theme.js';
import { FLOOR_LEVEL_PRESETS, CATEGORY_PRESETS } from './items-panel.js';
import { UNIT_CODES, UNITS, parseFeet, formatFtIn, DISTANCE_PRECISIONS } from '../core/units.js';
import { TILE_PATTERNS, TILE_SIZE_PRESETS, tilePatternWaste } from '../tools/controller.js';
import { classChoicesFrom, classClean, classNameProblem } from '../core/classify.js';
import { pyFixed, pyIntStr } from '../core/pyformat.js';

const host = () => document.getElementById('modal');

// ── this job's names first ────────────────────────────────────────────────
//
// Every Floor and Trade box offers THIS job's own floor levels and trades
// first -- each once, Level 2 before Level 10 -- and then the stock list
// without the look-alikes of names the job already has (desktop
// _fill_class_combo). A name he renamed to is what he picks next time, and
// the old stock spelling does not sit one tap away making a near-twin
// heading. The store is the open project's, handed in once at start-up
// (main.js) and read each time a form opens.
let classSource = () => ({});

/** Where the forms find the open job's items: fn() -> the measurement store. */
export function setClassSource(fn) {
  classSource = typeof fn === 'function' ? fn : () => ({});
}

/** A Floor ('floor_level') or Trade ('category') box's suggestions. */
export function classChoices(field) {
  let store = {};
  // A form that cannot see its job offers the stock list, as the desktop's
  // does when it finds no job (_project_values_near).
  try { store = classSource() || {}; } catch { store = {}; }
  return classChoicesFrom(store, field,
    field === 'floor_level' ? FLOOR_LEVEL_PRESETS : CATEGORY_PRESETS);
}

/** The dialogs currently on screen, oldest first. */
const stack = [];

/**
 * Show a dialog. `build` receives a close function and returns the element.
 * Escape and a click on the backdrop both cancel.
 *
 * Dialogs STACK. The assembly manager opens the material editor on top of
 * itself and the catalog opens its item editor, so a single-slot host would
 * destroy the parent and leave its promise unsettled — the caller hangs with
 * no error and no window.
 */
export function showDialog(build) {
  return new Promise(resolve => {
    const root = host();
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    // Each layer sits above the one below it, and only the top one is lit.
    layer.style.zIndex = String(80 + stack.length);

    let done = false;
    const close = value => {
      if (done) return;
      done = true;
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      layer.remove();
      document.removeEventListener('keydown', onKey, true);
      if (!stack.length) root.hidden = true;
      else stack[stack.length - 1].layer.classList.remove('behind');
      resolve(value);
    };

    const onKey = ev => {
      // Only the topmost dialog answers the keyboard.
      if (stack[stack.length - 1] !== entry) return;
      if (ev.key === 'Escape') { ev.stopPropagation(); close(null); }
    };

    const entry = { layer, close };
    const node = build(close);
    layer.appendChild(node);

    if (stack.length) stack[stack.length - 1].layer.classList.add('behind');
    stack.push(entry);
    root.hidden = false;
    root.appendChild(layer);
    document.addEventListener('keydown', onKey, true);
    layer.onmousedown = ev => { if (ev.target === layer) close(null); };

    // Focus the first field so the form is usable from the keyboard alone.
    queueMicrotask(() => {
      const f = node.querySelector('input,select,textarea,button.primary');
      f?.focus();
      if (f && f.select) f.select();
    });
  });
}

/** Close every open dialog, cancelling each. Used when a project is torn down. */
export function closeAllDialogs() {
  while (stack.length) stack[stack.length - 1].close(null);
}

export function dialogsOpen() { return stack.length > 0; }

function dlg({ title, body, buttons, wide = false }) {
  const d = el('div', `dlg${wide ? ' wide' : ''}`);
  d.appendChild(el('div', 'dlg-head', title));
  const b = el('div', 'dlg-body');
  b.appendChild(body);
  d.appendChild(b);
  const foot = el('div', 'dlg-foot');
  for (const btn of buttons) foot.appendChild(btn);
  d.appendChild(foot);
  return d;
}

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function button(label, cls, onClick) {
  const b = el('button', `btn${cls ? ' ' + cls : ''}`, label);
  b.addEventListener('click', onClick);
  return b;
}

function field(form, label, node, hint) {
  form.appendChild(el('label', null, label));
  form.appendChild(node);
  if (hint) {
    const h = el('div', 'hint', hint);
    form.appendChild(h);
  }
  return node;
}

function input(value = '', type = 'text', attrs = {}) {
  const i = document.createElement('input');
  i.type = type;
  i.value = value;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

function select(options, value) {
  const s = document.createElement('select');
  for (const o of options) {
    const opt = document.createElement('option');
    if (Array.isArray(o)) { opt.value = o[0]; opt.textContent = o[1]; }
    else { opt.value = o; opt.textContent = o === '' ? '(none)' : o; }
    s.appendChild(opt);
  }
  if (value !== undefined) s.value = value;
  return s;
}

/** An editable combo: a text input backed by a datalist of presets. */
function combo(value, presets, id) {
  const wrap = el('div');
  const i = input(value);
  i.setAttribute('list', id);
  const dl = document.createElement('datalist');
  dl.id = id;
  for (const p of presets) {
    if (!p) continue;
    const o = document.createElement('option');
    o.value = p;
    dl.appendChild(o);
  }
  wrap.appendChild(i);
  wrap.appendChild(dl);
  wrap.value_ = () => i.value;
  wrap.input = i;
  return wrap;
}

function swatches(current) {
  const wrap = el('div', 'swatches');
  let chosen = current ? current.slice() : TAKEOFF_PALETTE[0].slice();
  const make = c => {
    const s = el('button', 'swatch');
    s.type = 'button';
    s.style.background = rgba(c, 1);
    s.addEventListener('click', () => {
      chosen = c.slice();
      for (const n of wrap.querySelectorAll('.swatch')) n.classList.remove('on');
      s.classList.add('on');
    });
    if (near(c, chosen)) s.classList.add('on');
    return s;
  };
  for (const c of TAKEOFF_PALETTE) wrap.appendChild(make(c));

  const picker = input(hex(chosen), 'color');
  picker.style.cssText = 'width:26px;height:26px;padding:0;border:0;background:none;cursor:pointer';
  picker.title = 'Any other colour';
  picker.addEventListener('input', () => {
    chosen = fromHex(picker.value, chosen[3] ?? 0.35);
    for (const n of wrap.querySelectorAll('.swatch')) n.classList.remove('on');
  });
  wrap.appendChild(picker);

  wrap.value_ = () => chosen;
  return wrap;
}

function near(a, b) {
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01
      && Math.abs(a[2] - b[2]) < 0.01;
}

function costRadios(current = 'material') {
  const wrap = el('div', 'radio-row');
  const mk = (v, label) => {
    const l = el('label');
    const r = input('', 'radio');
    r.name = 'costType';
    r.value = v;
    r.checked = current === v;
    l.appendChild(r);
    l.appendChild(el('span', null, label));
    wrap.appendChild(l);
    return r;
  };
  mk('material', 'Material');
  mk('labor', 'Labor');
  wrap.value_ = () => wrap.querySelector('input:checked')?.value || 'material';
  return wrap;
}

// ── item properties ───────────────────────────────────────────────────────

/**
 * The form every drawing tool opens when it finishes.
 * Returns the item fields to merge, or null on cancel.
 */
export function askItem(opts = {}) {
  const {
    type = 'area', suggestedName = '', color = TAKEOFF_PALETTE[0],
    existing = null, catalog = null, spacingIn = null, gridCells = null,
    title = null,
  } = opts;
  const ex = existing || {};

  return showDialog(close => {
    const form = el('div', 'form');
    const name = field(form, 'Name', input(ex.name || suggestedName));
    if (catalog) name.setAttribute('list', 'catalogNames');

    const purpose = field(form, 'Purpose', input(ex.purpose || ''),
      'What it is for. Shown before the notes everywhere.');
    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || '', classChoices('floor_level'), 'floorPresets'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || '', classChoices('category'), 'catPresets'));
    const sub = field(form, 'Sub-group', input(ex.sub_category || ''));

    let spacing = null;
    if (spacingIn != null || ex.spacing_in != null) {
      spacing = field(form, 'Spacing (in)',
        input(String(ex.spacing_in ?? spacingIn ?? 12), 'number', { step: '0.25', min: '0.25' }),
        'Items are placed this far apart along the path.');
    }

    let cellW = null, cellH = null;
    if (gridCells || ex.cell_w_ft != null) {
      const row = el('div', 'radio-row');
      cellW = input(String(ex.cell_w_ft ?? gridCells?.[0] ?? 2), 'number', { step: '0.25', min: '0.05' });
      cellH = input(String(ex.cell_h_ft ?? gridCells?.[1] ?? 2), 'number', { step: '0.25', min: '0.05' });
      cellW.style.width = '80px'; cellH.style.width = '80px';
      row.append(cellW, el('span', null, '×'), cellH, el('span', null, 'ft'));
      field(form, 'Cell size', row);
    }

    let precision = null;
    if (type === 'distance') {
      precision = field(form, 'Precision',
        select(DISTANCE_PRECISIONS, ex.precision || '1/2'));
    }

    const costType = field(form, 'Type', costRadios(ex.cost_type || 'material'));
    const unitCost = field(form, 'Unit cost',
      input(String(ex.unit_cost ?? 0), 'number', { step: '0.01', min: '0' }));
    const colorPick = field(form, 'Colour', swatches(ex.color || color));

    const notes = document.createElement('textarea');
    notes.value = ex.notes || '';
    field(form, 'Notes', notes);

    const accept = () => {
      const out = {
        name: name.value.trim(),
        purpose: purpose.value.trim(),
        floor_level: floor.value_().trim(),
        category: cat.value_().trim(),
        sub_category: sub.value.trim(),
        cost_type: costType.value_(),
        unit_cost: Number(unitCost.value) || 0,
        color: colorPick.value_(),
        notes: notes.value,
      };
      if (spacing) out.spacingIn = Number(spacing.value) || 12;
      if (cellW) { out.cellW = Number(cellW.value) || 2; out.cellH = Number(cellH.value) || 2; }
      if (precision) out.precision = precision.value;
      close(out);
    };

    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); accept(); }
    });

    return dlg({
      title: title || `${existing ? 'Edit' : 'New'} ${LABEL_FOR[type] || 'Item'}`,
      body: form,
      buttons: [
        button('Cancel', '', () => close(null)),
        button('OK', 'primary', accept),
      ],
    });
  });
}

const LABEL_FOR = {
  area: 'Area', slope_area: 'Slope Roof', polyline: 'Polyline',
  linear_count: 'Array', grid: 'Grid', tile: 'Tile', count: 'Count',
  distance: 'Measurement', standalone: 'Item', window: 'Window', door: 'Door',
};

// ── slope roof ────────────────────────────────────────────────────────────

/**
 * The roof form. A traced footprint is the FLAT area; the pitch turns it into
 * the real sloped surface, and both numbers are kept so a reader can see the
 * difference rather than having to trust one number.
 */
export function askSlopeRoof({ flatArea, suggestedName = '', color, existing = null }) {
  const ex = existing || {};
  return showDialog(close => {
    const form = el('div', 'form');
    const name = field(form, 'Name', input(ex.name || suggestedName || 'Roof'));
    const pitch = field(form, 'Pitch (rise:12)',
      input(String(ex.pitch ?? 4), 'number', { step: '0.5', min: '0', max: '24' }));
    const readout = el('div', 'hint');
    form.appendChild(el('label', null, ''));
    form.appendChild(readout);

    const update = () => {
      const p = Number(pitch.value) || 0;
      const factor = Math.sqrt(1 + (p / 12) ** 2);
      const ang = (Math.atan2(p, 12) * 180) / Math.PI;
      readout.textContent =
        `Flat ${pyFixed(flatArea, 1)} sq ft  ×  ${pyFixed(factor, 4)}  =  ` +
        `${pyFixed(flatArea * factor, 1)} sq ft sloped   (${pyFixed(ang, 1)}°)`;
    };
    pitch.addEventListener('input', update);
    update();

    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || 'Roof', classChoices('floor_level'), 'floorPresets2'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || 'Roofing', classChoices('category'), 'catPresets2'));
    const sub = field(form, 'Sub-group', input(ex.sub_category || ''));
    const costType = field(form, 'Type', costRadios(ex.cost_type || 'material'));
    const unitCost = field(form, 'Unit cost',
      input(String(ex.unit_cost ?? 0), 'number', { step: '0.01', min: '0' }));
    const colorPick = field(form, 'Colour', swatches(ex.color || color));
    const notes = document.createElement('textarea');
    notes.value = ex.notes || '';
    field(form, 'Notes', notes);

    const accept = () => close({
      name: name.value.trim(),
      pitch: Number(pitch.value) || 0,
      floor_level: floor.value_().trim(),
      category: cat.value_().trim(),
      sub_category: sub.value.trim(),
      cost_type: costType.value_(),
      unit_cost: Number(unitCost.value) || 0,
      color: colorPick.value_(),
      notes: notes.value,
    });

    return dlg({
      title: 'Slope Roof',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── tile ──────────────────────────────────────────────────────────────────

export function askTile(setup) {
  const ex = setup.existing || {};
  return showDialog(close => {
    const form = el('div', 'form');
    const name = field(form, 'Name', input(ex.name || setup.suggestedName || ''));

    // The desktop's presets, rows of [label, w_in, h_in] (TILE_SIZE_PRESETS),
    // each keyed by its own size. The row showing is found by NUMBER -- within
    // 0.01, either way round -- as _sync_tile_preset_combo finds it, and is
    // 'Custom…' when no row is the size in the boxes.
    const presetKey = (w, h) => {
      const row = TILE_SIZE_PRESETS.find(([, pw, ph]) =>
        (Math.abs(pw - w) < 0.01 && Math.abs(ph - h) < 0.01)
        || (Math.abs(ph - w) < 0.01 && Math.abs(pw - h) < 0.01));
      return row ? `${row[1]}x${row[2]}` : 'custom';
    };
    const sizeSel = select(
      [...TILE_SIZE_PRESETS.map(([label, w, h]) => [`${w}x${h}`, label]), ['custom', 'Custom…']],
      presetKey(Number(setup.tileWIn), Number(setup.tileHIn))
    );
    field(form, 'Tile size', sizeSel);

    const customRow = el('div', 'radio-row');
    const tw = input(String(setup.tileWIn), 'number', { step: '0.25', min: '0.25' });
    const th = input(String(setup.tileHIn), 'number', { step: '0.25', min: '0.25' });
    tw.style.width = '80px'; th.style.width = '80px';
    customRow.append(tw, el('span', null, '×'), th, el('span', null, 'in'));
    field(form, 'Custom size', customRow);
    const syncCustom = () => {
      if (sizeSel.value === 'custom') return;
      const [w, h] = sizeSel.value.split('x');
      tw.value = w; th.value = h;
    };
    sizeSel.addEventListener('change', () => { syncCustom(); update(); });
    // A size typed by hand points the list at its row, or at Custom… (the
    // desktop's _tile_size_edited).
    for (const n of [tw, th]) {
      n.addEventListener('input', () => { sizeSel.value = presetKey(Number(tw.value), Number(th.value)); });
    }

    const pattern = field(form, 'Pattern',
      select(TILE_PATTERNS.map(([id, label]) => [id, label]), setup.pattern));
    const grout = field(form, 'Grout (in)',
      input(String(setup.groutIn), 'number', { step: '0.0625', min: '0' }));
    const waste = field(form, 'Waste %',
      input(String(setup.wastePct), 'number', { step: '1', min: '0', max: '60' }));
    const perBox = field(form, 'Tiles per box',
      input(String(setup.tilesPerBox || 0), 'number', { step: '1', min: '0' }),
      'Leave at 0 if you order loose.');

    const readout = el('div', 'hint');
    form.appendChild(el('label', null, ''));
    form.appendChild(readout);
    const update = () => {
      const w = Number(tw.value) || 12, h = Number(th.value) || 12;
      const gr = Number(grout.value) || 0;
      const tileArea = ((w + gr) * (h + gr)) / 144;
      const approx = tileArea > 0 ? Math.ceil(setup.areaFt2 / tileArea) : 0;
      const needed = Math.ceil(approx * (1 + (Number(waste.value) || 0) / 100));
      const pb = Number(perBox.value) || 0;
      // The desktop's numbers here (ItemPropertiesDialog._tile_refresh):
      // f"{area_ft2:,.1f}", f"{needed:,}", f"{int(math.ceil(needed / per_box)):,}".
      readout.textContent =
        `${pyFixed(setup.areaFt2, 1, true)} sq ft  ≈  ${pyIntStr(approx, true)} tiles  →  ` +
        `${pyIntStr(needed, true)} with waste` +
        (pb > 0 ? `  ·  ${pyIntStr(Math.ceil(needed / pb), true)} boxes` : '');
    };
    pattern.addEventListener('change', () => {
      waste.value = String(tilePatternWaste(pattern.value));
      update();
    });
    for (const n of [tw, th, grout, waste, perBox]) n.addEventListener('input', update);
    update();

    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || '', classChoices('floor_level'), 'floorPresets3'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || 'Flooring', classChoices('category'), 'catPresets3'));
    const costType = field(form, 'Type', costRadios(ex.cost_type || 'material'));
    const unitCost = field(form, 'Unit cost',
      input(String(ex.unit_cost ?? 0), 'number', { step: '0.01', min: '0' }));
    const colorPick = field(form, 'Colour', swatches(ex.color || setup.color));

    const accept = () => close({
      name: name.value.trim(),
      tileWIn: Number(tw.value) || 12,
      tileHIn: Number(th.value) || 12,
      groutIn: Number(grout.value) || 0,
      pattern: pattern.value,
      wastePct: Number(waste.value) || 0,
      tilesPerBox: Number(perBox.value) || 0,
      floor_level: floor.value_().trim(),
      category: cat.value_().trim(),
      cost_type: costType.value_(),
      unit_cost: Number(unitCost.value) || 0,
      color: colorPick.value_(),
    });

    return dlg({
      title: 'Tile',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── count arming ──────────────────────────────────────────────────────────

/**
 * The Count tool asks WHAT is being counted before it is entered, so that
 * every click afterwards just adds to the same item. Carrying on with an
 * existing count is the common case, so it comes first.
 *
 * `note`: why a tap is asking at all, when it asks instead of making a count
 * by itself (a Posts/Hardware count framed on the desktop, which this app
 * cannot make). Said above everything else.
 */
export function askCountItem({ existing = [], note = '' }) {
  return showDialog(close => {
    const body = el('div');
    if (note) {
      const why = el('div', 'hint', note);
      why.style.cssText = 'margin:0 0 12px;color:var(--warn);line-height:1.4';
      body.appendChild(why);
    }

    if (existing.length) {
      body.appendChild(el('div', 'hint', 'Carry on with a count already on this sheet:'));
      const list = el('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin:8px 0 16px';
      for (const m of existing) {
        const b = button(
          `${m.name || 'Unnamed'}   (${(m.points || []).length} so far)`, '',
          () => close({ continueItem: m })
        );
        b.style.textAlign = 'left';
        list.appendChild(b);
      }
      body.appendChild(list);
    }

    const form = el('div', 'form');
    const name = field(form, 'New count', input(''), 'What are you counting?');
    const cat = field(form, 'Group / Trade', combo('', classChoices('category'), 'catPresets4'));
    const floor = field(form, 'Floor / Level', combo('', classChoices('floor_level'), 'floorPresets4'));
    const costType = field(form, 'Type', costRadios('material'));
    const unitCost = field(form, 'Unit cost', input('0', 'number', { step: '0.01', min: '0' }));
    const colorPick = field(form, 'Colour', swatches(null));
    body.appendChild(form);

    const accept = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      close({
        spec: {
          name: n, label: n,
          category: cat.value_().trim(),
          floor_level: floor.value_().trim(),
          cost_type: costType.value_(),
          unit_cost: Number(unitCost.value) || 0,
          color: colorPick.value_(),
        },
      });
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
    });

    return dlg({
      title: 'Count',
      body,
      buttons: [button('Cancel', '', () => close(null)), button('Start counting', 'primary', accept)],
    });
  });
}

// ── openings ──────────────────────────────────────────────────────────────

export function askOpening(kind, item) {
  const pre = kind === 'window' ? 'win_' : 'door_';
  return showDialog(close => {
    const form = el('div', 'form');
    const tag = field(form, 'Mark / No.', input(item[pre + 'number'] || ''),
      `Leave blank to keep "${kind === 'window' ? 'Window' : 'Door'} ${item[pre + 'seq']}".`);
    const w = field(form, 'Width', input(item[pre + 'width'] || ''), 'e.g. 3\'-0" or 36"');
    const h = field(form, 'Height', input(item[pre + 'height'] || ''));
    const notes = document.createElement('textarea');
    notes.value = item.notes || '';
    field(form, 'Notes', notes);

    const accept = () => {
      const t = tag.value.trim();
      const name = t || `${kind === 'window' ? 'Window' : 'Door'} ${item[pre + 'seq']}`;
      close({
        [pre + 'number']: t,
        [pre + 'width']: w.value.trim(),
        [pre + 'height']: h.value.trim(),
        notes: notes.value,
        name, label: name,
      });
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); accept(); }
    });

    return dlg({
      title: kind === 'window' ? 'Window' : 'Door',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── standalone item ───────────────────────────────────────────────────────

export function askStandalone(existing = null) {
  const ex = existing || {};
  return showDialog(close => {
    const form = el('div', 'form');
    const name = field(form, 'Name', input(ex.name || ''));
    const qty = field(form, 'Quantity',
      input(String(ex.qty ?? ''), 'number', { step: 'any', min: '0' }));
    const unit = field(form, 'Unit',
      combo(ex.unit || 'each', ['each', ...UNIT_CODES.map(c => c.toLowerCase())], 'unitPresets'));
    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || '', classChoices('floor_level'), 'floorPresets5'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || '', classChoices('category'), 'catPresets5'));
    const sub = field(form, 'Sub-group', input(ex.sub_category || ''));
    const costType = field(form, 'Type', costRadios(ex.cost_type || 'material'));
    const unitCost = field(form, 'Unit cost',
      input(String(ex.unit_cost ?? 0), 'number', { step: '0.01', min: '0' }));
    const colorPick = field(form, 'Colour', swatches(ex.color || null));
    const notes = document.createElement('textarea');
    notes.value = ex.notes || '';
    field(form, 'Notes', notes);

    const accept = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      const q = Number(qty.value) || 0;
      close({
        type: 'standalone',
        name: n, label: n,
        qty: q, value: q,
        unit: unit.value_().trim() || 'each',
        floor_level: floor.value_().trim(),
        category: cat.value_().trim(),
        sub_category: sub.value.trim(),
        cost_type: costType.value_(),
        unit_cost: Number(unitCost.value) || 0,
        color: colorPick.value_(),
        notes: notes.value,
        points: [],
      });
    };

    return dlg({
      title: existing ? 'Edit Item' : 'Item Not on a Sheet',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── calibration ───────────────────────────────────────────────────────────

export function askCalibration({ distPx }) {
  return showDialog(close => {
    const form = el('div', 'form');
    const info = el('div', 'full');
    info.style.cssText = 'font-size:12.5px;color:#bdbdbd;margin-bottom:6px';
    info.textContent = `Line drawn: ${pyFixed(distPx, 1)} pixels`;
    form.appendChild(info);
    const len = field(form, 'True length', input('10'),
      'Feet, or feet and inches: 10, 10.5, 10\'-6"');
    const accept = () => {
      const ft = parseFeet(len.value);
      if (!(ft > 0)) { len.focus(); len.select(); return; }
      close(ft);
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
    });
    return dlg({
      title: 'Calibrate Scale',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('Set scale', 'primary', accept)],
    });
  });
}

// ── markup ────────────────────────────────────────────────────────────────

const NOTE_COLORS = [
  ['Yellow', [1.0, 220 / 255, 50 / 255, 1.0]],
  ['Orange', [1.0, 0.6, 0.2, 1.0]],
  ['Green', [0.45, 0.85, 0.45, 1.0]],
  ['Blue', [0.4, 0.7, 1.0, 1.0]],
  ['Pink', [1.0, 0.55, 0.8, 1.0]],
];

const NOTE_CATEGORIES = [
  '', 'General', 'Architecture', 'Structural', 'MEP',
  'Electrical', 'Plumbing', 'Mechanical', 'Demo',
];

/** The sticky note's text. Cancelling leaves no note behind. */
export function askNote({ fontSize = 12, existing = null } = {}) {
  const ex = existing || {};
  return showDialog(close => {
    const form = el('div', 'form');
    const text = document.createElement('textarea');
    text.value = ex.text || '';
    text.style.minHeight = '96px';
    field(form, 'Note', text);

    const cat = field(form, 'Category',
      combo(ex.note_category || '', NOTE_CATEGORIES, 'notePresets'));

    const colorWrap = el('div', 'swatches');
    let chosen = (ex.color || NOTE_COLORS[0][1]).slice();
    for (const [name, c] of NOTE_COLORS) {
      const b = el('button', 'swatch');
      b.type = 'button';
      b.title = name;
      b.style.background = rgba(c, 1);
      if (Math.abs(c[0] - chosen[0]) < 0.02 && Math.abs(c[1] - chosen[1]) < 0.02) {
        b.classList.add('on');
      }
      b.addEventListener('click', () => {
        chosen = c.slice();
        for (const n of colorWrap.querySelectorAll('.swatch')) n.classList.remove('on');
        b.classList.add('on');
      });
      colorWrap.appendChild(b);
    }
    field(form, 'Colour', colorWrap);

    const size = field(form, 'Text size',
      input(String(ex.font_size ?? fontSize), 'number', { min: '8', max: '48', step: '1' }));

    const accept = () => close({
      text: text.value,
      color: chosen,
      fontSize: Number(size.value) || 12,
      category: cat.value_().trim(),
    });
    // Enter inside a note is a newline, so only the button commits.
    return dlg({
      title: existing ? 'Edit Note' : 'Note',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

/**
 * A detail callout: the detail number over the sheet it lives on.
 * Either half may be blank — a bubble with one number is ordinary.
 */
export function askCallout({ existing = null, sheets = [] } = {}) {
  const ex = existing || {};
  return showDialog(close => {
    const form = el('div', 'form');
    const detail = field(form, 'Detail', input(ex.detail || ''),
      'The number above the line — 4, A, 12.');
    const sheet = field(form, 'On sheet', input(ex.ref_page_label || ''),
      'The number below it — S3.1, A2.4.');
    if (sheets.length) sheet.setAttribute('list', 'calloutSheets');

    let jump = null;
    if (sheets.length) {
      jump = field(form, 'Points at',
        select([['', '(no sheet in this project)'],
          ...sheets.map(([i, label]) => [String(i), label])],
        ex.ref_page != null ? String(ex.ref_page) : ''),
        'Optional — links the bubble to a sheet in this set.');
      jump.addEventListener('change', () => {
        const row = sheets.find(([i]) => String(i) === jump.value);
        if (row && !sheet.value.trim()) sheet.value = row[1];
      });
    }

    const accept = () => {
      const d = detail.value.trim(), sh = sheet.value.trim();
      if (!d && !sh) { detail.focus(); return; }
      close({
        detail: d,
        sheet: sh,
        refPage: jump && jump.value !== '' ? Number(jump.value) : null,
      });
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
    });

    return dlg({
      title: existing ? 'Edit Callout' : 'Detail Callout',
      body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── rename a heading / set the blank ones ─────────────────────────────────

/**
 * The small form behind an Items-list heading's Rename and Set (desktop
 * ClassificationDialog): a name -- this job's own names first (`own`), then
 * the stock list (`rest`) -- a sentence that says exactly what will change,
 * worked out by `describe(option)` before OK and again whenever the choice
 * moves, and where there is a choice of how far it reaches (`options`,
 * [[text, value]], the first one picked), that choice. Amber `notes` under
 * it. It changes nothing itself: it resolves {name, option} for the list
 * to act on, or null.
 *
 * OK refuses a blank name ('Type a name.'), the lists' own words ('All
 * Floors', 'Uncategorized', ... -- 'is what the lists call themselves'),
 * and, renaming (`old`), the name it already has -- said in red, and the
 * form stays up.
 */
export function askClassification({
  title, label, current = '', own = [], rest = [], describe = () => '',
  options = null, notes = [], old = null,
} = {}) {
  return showDialog(close => {
    const form = el('div', 'form cls-form');
    form.appendChild(el('div', 'full cls-label', label));
    const name = combo(current || '', [...own, ...rest], 'classNamePresets');
    name.classList.add('full', 'cls-name');
    form.appendChild(name);
    const what = el('div', 'full cls-what');
    const picks = [];
    const chosen = () => {
      for (const [r, v] of picks) if (r.checked) return v;
      return null;
    };
    const update = () => {
      let txt = '';
      try { txt = describe(chosen()) || ''; } catch { txt = ''; }
      what.textContent = txt;
    };
    if (options && options.length) {
      const box = el('div', 'full cls-opts');
      options.forEach(([text, value], i) => {
        const l = el('label');
        const r = input('', 'radio');
        r.name = 'classScope';
        r.value = String(i);
        r.checked = i === 0;
        r.addEventListener('change', update);
        l.appendChild(r);
        l.appendChild(el('span', null, text));
        box.appendChild(l);
        picks.push([r, value]);
      });
      form.appendChild(box);
    }
    form.appendChild(what);
    for (const n of notes || []) form.appendChild(el('div', 'full cls-note', n));
    const err = el('div', 'full cls-err');
    err.hidden = true;
    form.appendChild(err);
    update();
    const accept = () => {
      const nm = classClean(name.value_());
      let why = classNameProblem(nm);
      if (!why && old !== null && old !== undefined && nm === old) why = 'That is already its name.';
      if (why) {
        err.textContent = why;
        err.hidden = false;
        return;
      }
      close({ name: nm, option: chosen() });
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
    });
    return dlg({
      title, body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

// ── plain message and confirm ─────────────────────────────────────────────

export function alertDialog(title, message) {
  return showDialog(close => {
    const body = el('div');
    body.style.cssText = 'font-size:12.5px;line-height:1.6;white-space:pre-line';
    body.textContent = message;
    return dlg({ title, body, buttons: [button('OK', 'primary', () => close(true))] });
  });
}

export function confirmDialog(title, message, { okLabel = 'OK', danger = false } = {}) {
  return showDialog(close => {
    const body = el('div');
    body.style.cssText = 'font-size:12.5px;line-height:1.6;white-space:pre-line';
    body.textContent = message;
    return dlg({
      title, body,
      buttons: [
        button('Cancel', '', () => close(false)),
        button(okLabel, danger ? 'danger' : 'primary', () => close(true)),
      ],
    });
  });
}

/**
 * The desktop's QMessageBox.question: Yes and No, in that order. The default
 * button has the focus, so Enter answers it, as on the desktop; Escape and a
 * click outside answer No. Resolves true only for Yes.
 */
export function yesNoDialog(title, message, { defaultButton = 'No', danger = false } = {}) {
  return showDialog(close => {
    const body = el('div');
    body.style.cssText = 'font-size:12.5px;line-height:1.6;white-space:pre-line';
    body.textContent = message;
    const yesNo = defaultButton === 'Yes';
    return dlg({
      title, body,
      buttons: [
        button('Yes', yesNo ? 'primary' : (danger ? 'danger' : ''), () => close(true)),
        button('No', yesNo ? '' : 'primary', () => close(false)),
      ],
    });
  }).then(v => v === true);
}

/**
 * A question whose answers are named in full, one button each, in the order
 * given (the desktop's QMessageBox with buttons of its own: text, the
 * informative text under it). `choices` are {key, label, danger}; the one
 * whose key is `defaultKey` has the focus, so Enter answers it, and Escape
 * and a click outside answer null -- as the desktop's Cancel. The answers
 * stack one per line: they are sentences. Resolves to the key pressed, or
 * null.
 */
export function choiceDialog(title, text, info, choices, { defaultKey = null } = {}) {
  return showDialog(close => {
    const body = el('div');
    body.style.cssText = 'font-size:12.5px;line-height:1.6;white-space:pre-line';
    body.appendChild(el('div', 'choice-text', text));
    if (info) body.appendChild(el('div', 'choice-info', info));
    const d = dlg({
      title, body,
      buttons: choices.map(c => button(c.label,
        c.key === defaultKey ? 'primary' : (c.danger ? 'danger' : ''), () => close(c.key))),
    });
    d.querySelector('.dlg-foot')?.classList.add('stack');
    return d;
  }).then(v => (v === undefined ? null : v));
}

export function promptDialog(title, label, value = '', hint = '') {
  return showDialog(close => {
    const form = el('div', 'form');
    const i = field(form, label, input(value), hint);
    const accept = () => close(i.value);
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') { ev.preventDefault(); accept(); }
    });
    return dlg({
      title, body: form,
      buttons: [button('Cancel', '', () => close(null)), button('OK', 'primary', accept)],
    });
  });
}

export { dlg, button, input, select, combo, field, swatches, costRadios };

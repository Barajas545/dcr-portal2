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

const host = () => document.getElementById('modal');

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
      combo(ex.floor_level || '', FLOOR_LEVEL_PRESETS, 'floorPresets'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || '', CATEGORY_PRESETS, 'catPresets'));
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
        `Flat ${flatArea.toFixed(1)} sq ft  ×  ${factor.toFixed(4)}  =  ` +
        `${(flatArea * factor).toFixed(1)} sq ft sloped   (${ang.toFixed(1)}°)`;
    };
    pitch.addEventListener('input', update);
    update();

    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || 'Roof', FLOOR_LEVEL_PRESETS, 'floorPresets2'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || 'Roofing', CATEGORY_PRESETS, 'catPresets2'));
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

    const sizeSel = select(
      [...TILE_SIZE_PRESETS.map(([w, h]) => [`${w}x${h}`, `${w}″ × ${h}″`]), ['custom', 'Custom…']],
      `${setup.tileWIn}x${setup.tileHIn}`
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
      readout.textContent =
        `${setup.areaFt2.toFixed(1)} sq ft  ≈  ${approx.toLocaleString('en-US')} tiles  →  ` +
        `${needed.toLocaleString('en-US')} with waste` +
        (pb > 0 ? `  ·  ${Math.ceil(needed / pb)} boxes` : '');
    };
    pattern.addEventListener('change', () => {
      waste.value = String(tilePatternWaste(pattern.value));
      update();
    });
    for (const n of [tw, th, grout, waste, perBox]) n.addEventListener('input', update);
    update();

    const floor = field(form, 'Floor / Level',
      combo(ex.floor_level || '', FLOOR_LEVEL_PRESETS, 'floorPresets3'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || 'Flooring', CATEGORY_PRESETS, 'catPresets3'));
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
 */
export function askCountItem({ existing = [] }) {
  return showDialog(close => {
    const body = el('div');

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
    const cat = field(form, 'Group / Trade', combo('', CATEGORY_PRESETS, 'catPresets4'));
    const floor = field(form, 'Floor / Level', combo('', FLOOR_LEVEL_PRESETS, 'floorPresets4'));
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
      combo(ex.floor_level || '', FLOOR_LEVEL_PRESETS, 'floorPresets5'));
    const cat = field(form, 'Group / Trade',
      combo(ex.category || '', CATEGORY_PRESETS, 'catPresets5'));
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
    info.textContent = `Line drawn: ${distPx.toFixed(1)} pixels`;
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

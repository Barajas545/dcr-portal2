// assemblies.js — the materials hung off one takeoff item.
//
// An associated item is a material or labor line that belongs to a measured
// item: the studs in a wall, the nails in the studs, the hours to stand it up.
// Its quantity is one of exactly two things and nothing in between:
//
//   total     a flat number, whatever the parent measures
//   per_unit  a rate, multiplied by the parent's own measured value
//
// The legacy field `qty_per` means per_unit. There is no unit conversion and
// no coverage factor anywhere in this model — if a supplier sells OSB by the
// sheet and the wall is measured in square feet, the estimator enters the rate
// per square foot. Inventing a conversion here would put an unchecked number
// into a bid.

import * as D from './dialogs.js';
import { assemblyTotal, notesWithPurpose } from '../core/measure.js';
import { attachSearch, catalogPrice } from './catalog.js';
import { FLOOR_LEVEL_PRESETS, CATEGORY_PRESETS } from './items-panel.js';

/** The "Per <hint>" label, by what the parent measures. */
const UNIT_HINT = {
  area: 'sq ft', slope_area: 'sq ft', grid: 'sq ft', tile: 'sq ft',
  distance: 'ft', polyline: 'ft',
};

function hintFor(type) { return UNIT_HINT[type] || 'item'; }

const UNIT_OPTIONS = [
  'each', 'sq ft', 'ft', 'lf', 'sheet', 'board', 'bag', 'box', 'bundle',
  'roll', 'gal', 'lb', 'ton', 'cy', 'hour', 'day', 'ls',
];

/**
 * The manager: the full list for one item, with running totals.
 * Resolves with the new associated_items array, or null if cancelled.
 */
export function openAssemblyManager(item) {
  const parentValue = Number(item.value) || 0;
  const hint = hintFor(item.type);
  let lines = (item.associated_items || []).map(l => ({ ...l }));

  return D.showDialog(close => {
    const body = D.el('div');

    const head = D.el('div', 'hint');
    head.style.cssText = 'margin-bottom:10px;color:#bdbdbd;font-size:12px';
    head.textContent =
      `${item.name || item.label || 'Item'} — ${parentValue.toLocaleString('en-US', {
        maximumFractionDigits: 2,
      })} ${hint}. A "per unit" line multiplies by that figure.`;
    body.appendChild(head);

    const wrap = D.el('div');
    wrap.style.cssText = 'max-height:46vh;overflow:auto;border:1px solid #2c2c2c;border-radius:6px';
    const table = D.el('table', 'grid');
    const thead = D.el('thead');
    const hr = D.el('tr');
    for (const [label, cls] of [['Material', ''], ['Qty', 'num'], ['Unit', ''],
      ['Total', 'num'], ['Unit cost', 'num'], ['Cost', 'num'], ['Type', ''], ['', '']]) {
      hr.appendChild(D.el('th', cls, label));
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = D.el('tbody');
    table.appendChild(tb);
    wrap.appendChild(table);
    body.appendChild(wrap);

    const foot = D.el('div');
    foot.style.cssText = 'margin-top:10px;font-size:12px;color:#bdbdbd;text-align:right';
    body.appendChild(foot);

    const draw = () => {
      tb.textContent = '';
      let cost = 0;
      lines.forEach((l, i) => {
        const total = assemblyTotal(l, parentValue);
        const lineCost = total * (Number(l.unit_cost) || 0);
        cost += lineCost;
        const tr = D.el('tr');
        const nameCell = D.el('td', null, l.name || '(unnamed)');
        if (l.purpose || l.notes) {
          const n = D.el('div', null, notesWithPurpose(l));
          n.style.cssText = 'font-size:10.5px;color:#7d7d7d;margin-top:2px';
          nameCell.appendChild(n);
        }
        tr.appendChild(nameCell);
        const qtyText = (l.qty_mode ?? (('qty_per' in l) ? 'per_unit' : 'total')) === 'per_unit'
          ? `${num(l.qty ?? l.qty_per)} per ${hint}`
          : num(l.qty ?? l.qty_per);
        tr.appendChild(D.el('td', 'num', qtyText));
        tr.appendChild(D.el('td', null, l.unit || 'each'));
        tr.appendChild(D.el('td', 'num', num(total)));
        tr.appendChild(D.el('td', 'num', l.unit_cost ? money(l.unit_cost) : ''));
        tr.appendChild(D.el('td', 'num', lineCost ? money(lineCost) : ''));
        tr.appendChild(D.el('td', null, (l.cost_type || 'material') === 'labor' ? 'Labor' : 'Material'));

        const act = D.el('td');
        const edit = D.el('button', null, '✎');
        edit.style.cssText = 'background:none;border:0;color:#8ab;cursor:pointer;font-size:13px';
        edit.title = 'Edit';
        edit.addEventListener('click', async ev => {
          ev.stopPropagation();
          const patch = await editLine(item, lines[i], hint);
          if (patch) { lines[i] = patch; draw(); }
        });
        const del = D.el('button', null, '✕');
        del.style.cssText = 'background:none;border:0;color:#c88;cursor:pointer;font-size:13px';
        del.title = 'Remove';
        del.addEventListener('click', ev => {
          ev.stopPropagation();
          lines.splice(i, 1);
          draw();
        });
        act.append(edit, del);
        tr.appendChild(act);
        tr.addEventListener('dblclick', async () => {
          const patch = await editLine(item, lines[i], hint);
          if (patch) { lines[i] = patch; draw(); }
        });
        tb.appendChild(tr);
      });
      if (!lines.length) {
        const tr = D.el('tr');
        const td = D.el('td', null, 'No materials on this item yet.');
        td.colSpan = 8;
        td.style.cssText = 'color:#585858;font-style:italic;padding:18px;text-align:center';
        tr.appendChild(td);
        tb.appendChild(tr);
      }
      foot.textContent = cost
        ? `${lines.length} line${lines.length === 1 ? '' : 's'}   ·   ${money(cost)}`
        : `${lines.length} line${lines.length === 1 ? '' : 's'}`;
    };
    draw();

    return D.dlg({
      title: 'Associated Materials',
      wide: true,
      body,
      buttons: [
        D.button('Add material…', '', async () => {
          const line = await editLine(item, null, hint);
          if (line) { lines.push(line); draw(); }
        }),
        D.button('Cancel', '', () => close(null)),
        D.button('OK', 'primary', () => close(lines)),
      ],
    });
  });
}

/** One material line. Resolves with the line, or null on cancel. */
export function editLine(parent, existing, hint) {
  const ex = existing || {};
  const mode = ex.qty_mode ?? (('qty_per' in ex && !('qty_mode' in ex)) ? 'per_unit' : 'total');

  return D.showDialog(close => {
    const form = D.el('div', 'form');

    const name = D.field(form, 'Material', D.input(ex.name || ''),
      'Start typing to search the catalog — 248d, 2x4x8, 1/2 cdx…');
    const unitCostRef = { node: null };
    const unitRef = { node: null };
    const kindRef = { node: null };

    // A catalog pick fills in the price, the unit and Material/Labor, then
    // moves on to the quantity — the name is settled, the question is how many.
    const detach = attachSearch(name, it => {
      const price = catalogPrice(it.price);
      if (price > 0 && unitCostRef.node) unitCostRef.node.value = String(price);
      if (unitRef.node) unitRef.node.value = String(it.unit || 'each').toLowerCase();
      if (kindRef.node) {
        for (const r of kindRef.node.querySelectorAll('input')) {
          r.checked = r.value === (it.kind === 'labor' ? 'labor' : 'material');
        }
      }
      qty.focus();
      qty.select();
    });

    const purpose = D.field(form, 'Purpose', D.input(ex.purpose || ''),
      'What it is for. Prints on the yard sheet.');

    const qty = D.field(form, 'Quantity',
      D.input(String(ex.qty ?? ex.qty_per ?? 1), 'number',
        { step: '0.001', min: '0.001', max: '99999' }));

    const modeWrap = D.el('div', 'radio-row');
    const mkMode = (v, label) => {
      const l = D.el('label');
      const r = D.input('', 'radio');
      r.name = 'qtyMode';
      r.value = v;
      r.checked = mode === v;
      r.addEventListener('change', updateReadout);
      l.append(r, D.el('span', null, label));
      modeWrap.appendChild(l);
    };
    mkMode('total', 'Total');
    mkMode('per_unit', `Per ${hint}`);
    D.field(form, 'Quantity is', modeWrap);

    const unit = D.field(form, 'Unit',
      D.combo(ex.unit || 'each', UNIT_OPTIONS, 'assemblyUnits'));
    unitRef.node = unit.input;

    const unitCost = D.field(form, 'Unit cost',
      D.input(String(ex.unit_cost ?? 0), 'number', { step: '0.01', min: '0' }));
    unitCostRef.node = unitCost;

    const kind = D.field(form, 'Type', D.costRadios(ex.cost_type || 'material'));
    kindRef.node = kind;

    const floor = D.field(form, 'Floor / Level',
      D.combo(ex.floor_level || '', FLOOR_LEVEL_PRESETS, 'aiFloor'),
      'Blank inherits the parent item’s.');
    const cat = D.field(form, 'Group / Trade',
      D.combo(ex.category || '', CATEGORY_PRESETS, 'aiCat'));
    const sub = D.field(form, 'Sub-group', D.input(ex.sub_category || ''));

    const notes = document.createElement('textarea');
    notes.value = ex.notes || '';
    D.field(form, 'Notes', notes);

    const readout = D.el('div', 'hint');
    form.appendChild(D.el('label', null, ''));
    form.appendChild(readout);

    function updateReadout() {
      const m = modeWrap.querySelector('input:checked')?.value || 'total';
      const q = Number(qty.value) || 0;
      const pv = Number(parent.value) || 0;
      const total = m === 'total' ? q : q * pv;
      const c = total * (Number(unitCost.value) || 0);
      readout.textContent = m === 'total'
        ? `${num(total)} ${unit.value_() || 'each'}${c ? `   ·   ${money(c)}` : ''}`
        : `${num(q)} × ${num(pv)} ${hint} = ${num(total)} ${unit.value_() || 'each'}` +
          `${c ? `   ·   ${money(c)}` : ''}`;
    }
    for (const n of [qty, unitCost, unit.input]) n.addEventListener('input', updateReadout);
    updateReadout();

    const accept = () => {
      const n = name.value.trim();
      if (!n) { name.focus(); return; }
      detach();
      close({
        name: n,
        purpose: purpose.value.trim(),
        qty: Number(qty.value) || 0,
        qty_mode: modeWrap.querySelector('input:checked')?.value || 'total',
        unit: unit.value_().trim() || 'each',
        unit_cost: Number(unitCost.value) || 0,
        cost_type: kind.value_(),
        floor_level: floor.value_().trim(),
        category: cat.value_().trim(),
        sub_category: sub.value.trim(),
        notes: notes.value,
      });
    };
    form.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA') { ev.preventDefault(); accept(); }
    });

    return D.dlg({
      title: existing ? 'Edit Material' : 'Associated Material',
      body: form,
      buttons: [
        D.button('Cancel', '', () => { detach(); close(null); }),
        D.button('OK', 'primary', accept),
      ],
    });
  });
}

function num(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

function money(v) {
  return Number(v).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// report-html.js — the printable reports.
//
// THE ONE RULE THAT SHAPES ALL OF THIS: a subtotal is never a single number.
//
// A group holds square feet, linear feet and each, and adding them together
// produces a figure that looks like a quantity and is not one. So every total
// line is a list, one entry per unit, biggest first:
//
//     Subtotal Framing:   1,240 LF   ·   86 EA   ·   $18,432.50
//
// The money is the only thing that legitimately sums across units, and it is
// shown only when costs are switched on.

import { notesWithPurpose } from '../core/measure.js';

const CT_ORDER = { labor: 0, material: 1 };

export const PRINT_CSS = `
<style>
 .rpt { font: 12px/1.5 'Segoe UI', system-ui, sans-serif; color:#111; }
 .rpt h1 { font-size:19px; margin:0 0 2px; }
 .rpt .sub { color:#666; font-size:12px; margin:0 0 2px; }
 .rpt .meta { color:#666; font-size:11px; margin:0 0 14px; }
 .rpt table { width:100%; border-collapse:collapse; }
 .rpt th { text-align:left; font-size:10.5px; text-transform:uppercase;
           letter-spacing:.4px; color:#fff; background:#1f3864; padding:5px 7px; }
 .rpt td { padding:4px 7px; border-bottom:1px solid #e6e6e6; vertical-align:top; }
 .rpt td.n, .rpt th.n { text-align:right; white-space:nowrap;
                        font-variant-numeric:tabular-nums; }
 .rpt tr.band td { font-weight:700; padding:5px 7px; }
 .rpt tr.labor td { background:#5a4410; color:#f5c97a; }
 .rpt tr.material td { background:#173a5e; color:#7ab8f5; }
 .rpt tr.floor td { background:#005580; color:#fff; }
 .rpt tr.cat td { background:#2d5a27; color:#fff; }
 .rpt tr.sub td { background:#3d3d00; color:#fff; }
 .rpt tr.sub2 td { background:#eef1f6; text-align:right; font-size:10.5px;
                   font-style:italic; color:#334; }
 .rpt tr.sub1 td { background:#dde4ee; text-align:right; font-weight:700;
                   color:#1d3a5f; }
 .rpt tr.sect td { text-align:right; font-weight:700; color:#fff; }
 .rpt tr.sect.labor td { background:#5a4410; color:#fff; }
 .rpt tr.sect.material td { background:#1f3864; color:#fff; }
 .rpt tr.grand td { background:#1f3864; color:#fff; font-weight:700; }
 .rpt tr.mat td { color:#555; }
 .rpt tr.mat td:first-child { padding-left:26px; }
 .rpt .note { color:#666; font-size:11px; }
 .rpt .dim { color:#8a8a8a; font-size:10.5px; }
 .rpt .warn { color:#a33; font-weight:600; }
 @media print { .rpt tr { page-break-inside: avoid; } .rpt thead { display: table-header-group; } }
</style>`;

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function money(v) {
  return Number(v).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

/** 1234.5 → "1,234.5"; trailing zeros dropped; 0 → "0". */
export function fmtQty(q) {
  if (!q) return '0';
  const s = Number(q).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * "1,240 LF   ·   86 EA" — one entry per unit, biggest first.
 *
 * This is the ONLY way a group of mixed items is totalled. Summing square feet
 * into linear feet gives a number that reads like a quantity and means nothing.
 */
export function unitTotals(entries) {
  const tot = {};
  for (const e of entries) {
    const u = e.unit || '';
    if (!u) continue;
    tot[u] = (tot[u] || 0) + (Number(e.qty) || 0);
  }
  return Object.entries(tot)
    .sort((a, b) => b[1] - a[1])
    .map(([u, v]) => `${fmtQty(v)} ${u}`)
    .join('   ·   ');
}

/**
 * The total string for a set of entries: the per-unit list, and the money if
 * costs are on. Associated-material cost counts only when materials are shown,
 * because that is the number the reader can see being added up.
 */
export function totalString(entries, { costs, materials }) {
  let s = unitTotals(entries);
  if (costs) {
    let mv = 0;
    for (const e of entries) {
      mv += e.cost || 0;
      if (materials) for (const m of e.materials || []) mv += m.cost || 0;
    }
    if (mv > 0) s += `${s ? '   ·   ' : ''}${money(mv)}`;
  }
  return s || '—';
}

export function docHeader(md, title, subtitle) {
  const pieces = [md.internal_id_number, md.client_name, md.project_address]
    .filter(Boolean).join('   ·   ');
  const meta = [
    md.estimator_name ? `Estimator: ${md.estimator_name}` : '',
    md.bid_date ? `Bid date: ${md.bid_date}` : '',
    `Printed ${new Date().toLocaleDateString('en-US')}`,
  ].filter(Boolean).join('   ·   ');
  return `${PRINT_CSS}<div class="rpt">
    <h1>${esc(md.project_name || '(Untitled project)')}</h1>
    ${pieces ? `<p class="sub">${esc(pieces)}</p>` : ''}
    <p class="sub"><strong>${esc(title)}</strong>${subtitle ? ` — ${esc(subtitle)}` : ''}</p>
    <p class="meta">${esc(meta)}</p>`;
}

/**
 * The engine behind Estimate Summary, Material Takeoff and Labor Estimate.
 *
 * Bands run cost type → g1 → g2, where g1/g2 are Floor then Trade, or Trade
 * then Floor. A blank level prints no band of its own but still closes the
 * group below it, so an item with no sub-group never inherits the previous
 * item's heading.
 */
export function groupedHtml(items, options) {
  const byFloorFirst = options.groupBy !== 'tf';
  const g1 = e => (byFloorFirst ? e.floor : e.category) || '';
  const g2 = e => (byFloorFirst ? e.category : e.floor) || '';
  const g1Label = byFloorFirst ? 'Floor' : 'Trade';
  const g2Label = byFloorFirst ? 'Trade' : 'Floor';

  const sorted = items.slice().sort((a, b) => {
    const ka = [CT_ORDER[a.costType] ?? 1, g1(a), g2(a), a.sub || ''];
    const kb = [CT_ORDER[b.costType] ?? 1, g1(b), g2(b), b.sub || ''];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    return 0;
  });

  const cols = ['Item', 'Qty', 'Unit'];
  if (options.sheets) cols.push('Sheet');
  if (options.costs) cols.push('Unit Cost', 'Total');
  if (options.notes) cols.push('Notes');
  const nCols = cols.length;
  const numCol = i => i === 1 || (options.costs && cols[i] && /Cost|Total/.test(cols[i]));

  const out = [`<table><thead><tr>${cols.map((c, i) =>
    `<th${numCol(i) ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>`];

  const span = (cls, html) => out.push(`<tr class="${cls}"><td colspan="${nCols}">${html}</td></tr>`);

  let ct = null, k1 = null, k2 = null;
  let sectAcc = [], acc1 = [], acc2 = [];
  const opts = { costs: options.costs, materials: options.materials };

  const flush2 = () => {
    if (options.subtotals && acc2.length && k2) {
      span('sub2', `<i>Subtotal ${esc(k2)}: &nbsp;${esc(totalString(acc2, opts))}</i>`);
    }
    acc2 = [];
  };
  const flush1 = () => {
    flush2();
    if (options.subtotals && acc1.length && k1) {
      span('sub1', `Total ${esc(g1Label)} ${esc(k1)}: &nbsp;${esc(totalString(acc1, opts))}`);
    }
    acc1 = [];
  };
  const flushSection = () => {
    flush1();
    if (sectAcc.length && ct) {
      // The section total is always printed, subtotals switch or not: it is
      // the number the reader came for.
      out.push(`<tr class="sect ${ct}"><td colspan="${nCols}">` +
        `${ct === 'labor' ? 'LABOR' : 'MATERIAL'} TOTAL: &nbsp;` +
        `${esc(totalString(sectAcc, opts))}</td></tr>`);
    }
    sectAcc = [];
  };

  for (const it of sorted) {
    if (it.costType !== ct) {
      flushSection();
      ct = it.costType;
      k1 = null; k2 = null;
      span(`band ${ct}`, ct === 'labor' ? 'LABOR' : 'MATERIAL');
    }
    if (g1(it) !== k1) {
      flush1();
      k1 = g1(it); k2 = null;
      if (k1) span('band floor', `&nbsp;&nbsp;${esc(g1Label)}: ${esc(k1)}`);
    }
    if (g2(it) !== k2) {
      flush2();
      k2 = g2(it);
      if (k2) span('band cat', `&nbsp;&nbsp;&nbsp;&nbsp;${esc(g2Label)}: ${esc(k2)}`);
    }

    sectAcc.push(it); acc1.push(it); acc2.push(it);
    if (options.totalsOnly) continue;

    out.push(itemRow(it, options, cols, numCol));
    if (options.materials) {
      for (const m of it.materials) out.push(itemRow(m, options, cols, numCol, true));
    }
  }
  flushSection();

  if (!sorted.length) {
    return '<p style="color:#6a7480"><i>No matching items.</i></p></div>';
  }

  // The grand total is the whole selection, per unit, and the money.
  out.push(`<tr class="grand"><td colspan="${nCols}">GRAND TOTAL: &nbsp;` +
    `${esc(totalString(sorted, opts))}</td></tr>`);
  out.push('</tbody></table></div>');
  return out.join('');
}

function itemRow(e, options, cols, numCol, isMaterial = false) {
  const cells = [];
  let name = esc(e.name || '(unnamed)');
  if (e.detail) name += ` <span class="dim">${esc(e.detail)}</span>`;
  if (e.selfIntersects) {
    // A crossed outline reads as a small or zero area under the shoelace
    // formula. Flag it rather than quietly totalling a number nobody drew.
    name += ' <span class="warn">⚠ outline crosses itself</span>';
  }
  cells.push(name);
  cells.push(fmtQty(e.qty));
  cells.push(esc(e.unit || ''));
  if (options.sheets) cells.push(esc(e.sheet || ''));
  if (options.costs) {
    cells.push(e.rate ? money(e.rate) : '');
    cells.push(e.cost ? money(e.cost) : '');
  }
  if (options.notes) cells.push(`<span class="note">${esc(e.notes || '')}</span>`);
  return `<tr class="${isMaterial ? 'mat' : ''}">${cells.map((c, i) =>
    `<td${numCol(i) ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`;
}

/** Same-named quantities merged into one line each. */
export function rollupHtml(items, options) {
  const rows = [];
  for (const it of items) {
    rows.push(it);
    if (options.materials) for (const m of it.materials) rows.push(m);
  }
  const buckets = new Map();
  for (const r of rows) {
    // The key is cost type, lower-cased name and unit — a material and a
    // measured item of the same name and unit merge, which is the point.
    const key = `${r.costType} ${String(r.name).toLowerCase()} ${r.unit}`;
    const b = buckets.get(key) || {
      costType: r.costType, name: r.name, unit: r.unit, qty: 0, cost: 0, n: 0,
    };
    b.qty += Number(r.qty) || 0;
    b.cost += r.cost || 0;
    b.n += 1;
    buckets.set(key, b);
  }
  const list = [...buckets.values()];
  const showCost = options.costs && list.some(b => b.cost > 0);
  const nCols = showCost ? 5 : 4;
  const out = [`<table><thead><tr><th>Item</th><th class="n">Qty</th><th>Unit</th>` +
    `<th class="n">Lines</th>${showCost ? '<th class="n">Total</th>' : ''}</tr></thead><tbody>`];

  for (const ct of ['labor', 'material']) {
    const sec = list.filter(b => b.costType === ct)
      .sort((a, b) => String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase()));
    if (!sec.length) continue;
    out.push(`<tr class="band ${ct}"><td colspan="${nCols}">${ct === 'labor' ? 'LABOR' : 'MATERIAL'}</td></tr>`);
    for (const b of sec) {
      out.push(`<tr><td>${esc(b.name || '(unnamed)')}</td><td class="n">${fmtQty(b.qty)}</td>` +
        `<td>${esc(b.unit)}</td><td class="n">${b.n}</td>` +
        (showCost ? `<td class="n">${b.cost ? money(b.cost) : ''}</td>` : '') + '</tr>');
    }
    out.push(`<tr class="sect ${ct}"><td colspan="${nCols}">` +
      `${ct === 'labor' ? 'LABOR' : 'MATERIAL'} TOTAL: &nbsp;${esc(totalString(sec, { costs: showCost, materials: false }))}` +
      `</td></tr>`);
  }
  out.push('</tbody></table></div>');
  return out.join('');
}

/** The window and door schedules. */
export function scheduleHtml(items, kind) {
  const pre = kind === 'window' ? 'win_' : 'door_';
  const noun = kind === 'window' ? 'windows' : 'doors';
  const recs = items.filter(i => i.type === kind)
    .sort((a, b) => (Number(a.src?.[pre + 'seq']) || 0) - (Number(b.src?.[pre + 'seq']) || 0));
  if (!recs.length) {
    return `<p style="color:#6a7480"><i>No ${noun} in this project.</i></p></div>`;
  }
  const out = [`<table><thead><tr><th>Pin #</th>` +
    `<th>${kind === 'window' ? 'Window' : 'Door'} No.</th>` +
    `<th>Width</th><th>Height</th><th>Sheet</th><th>Notes</th></tr></thead><tbody>`];
  let noSize = 0;
  for (const r of recs) {
    const s = r.src || {};
    const w = s[pre + 'width'] || '';
    const h = s[pre + 'height'] || '';
    if (!w && !h) noSize += 1;
    out.push(`<tr><td>${esc(s[pre + 'seq'] ?? '')}</td><td>${esc(s[pre + 'number'] || '')}</td>` +
      `<td>${esc(w)}</td><td>${esc(h)}</td><td>${esc(r.sheet)}</td>` +
      `<td class="note">${esc(r.notes || '')}</td></tr>`);
  }
  out.push(`<tr class="grand"><td colspan="6">GRAND TOTAL: ${recs.length} ${noun}` +
    (noSize ? `  (${noSize} without size yet)` : '') + '</td></tr>');
  out.push('</tbody></table></div>');
  return out.join('');
}

/**
 * The yard sheet: banded by floor and room, in FIRST-SEEN order rather than
 * sorted, so it reads in the order the estimator worked.
 */
export function matListHtml(md, items, options) {
  // The caller has already promoted every material to a row of its own, so
  // these ARE the lines — flattening again here would drop the parents that
  // carry no materials.
  const lines = items;
  const groups = [];
  const index = new Map();
  for (const l of lines) {
    const key = `${l.floor || ''} ${l.sub || l.category || ''}`;
    if (!index.has(key)) {
      index.set(key, groups.length);
      groups.push({ floor: l.floor || '', room: l.sub || l.category || '', lines: [] });
    }
    groups[index.get(key)].lines.push(l);
  }

  const co = [md.company_name, md.company_address, md.company_phone]
    .filter(Boolean).join('   ·   ');
  const out = [`${PRINT_CSS}<div class="rpt">`];
  if (co) out.push(`<p class="sub" style="font-weight:700">${esc(co)}</p>`);
  out.push(`<h1>${esc(md.project_name || 'Material List')}</h1>`);
  out.push(`<p class="meta">${esc([md.project_address, md.internal_id_number]
    .filter(Boolean).join('   ·   '))}   ·   Printed ${new Date().toLocaleDateString('en-US')}</p>`);

  if (!groups.length) {
    out.push('<p style="color:#6a7480"><i>No matching items.</i></p></div>');
    return out.join('');
  }

  for (const grp of groups) {
    const heading = [grp.floor, grp.room].filter(Boolean).join('  —  ') || 'General';
    out.push('<table style="margin-bottom:16px"><thead>' +
      `<tr><th colspan="5" style="background:#005580">${esc(heading)}</th></tr>` +
      '<tr><th>Item</th><th>Purpose</th><th class="n">Qty</th><th>Unit</th><th>Notes</th></tr>' +
      '</thead><tbody>');
    for (const l of grp.lines) {
      out.push(`<tr><td>${esc(l.name || '(unnamed)')}</td><td>${esc(l.purpose || '')}</td>` +
        `<td class="n">${fmtQty(l.qty)}</td><td>${esc(l.unit)}</td>` +
        `<td class="note">${esc(l.notes || '')}</td></tr>`);
    }
    out.push(`<tr class="sub2"><td colspan="5"><i>Subtotal: &nbsp;` +
      `${esc(unitTotals(grp.lines))}</i></td></tr>`);
    out.push('</tbody></table>');
  }
  out.push('</div>');
  return out.join('');
}

export { notesWithPurpose };

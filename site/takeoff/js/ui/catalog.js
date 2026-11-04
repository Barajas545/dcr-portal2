// catalog.js — the materials catalog, its search, and its editor.
//
// The estimator types shorthand into any name box and the catalog answers.
// "248d", "d248", "2x4x8df" and "DF248" all have to find the same stud, so the
// matcher is not a substring search: every space-separated token must FIT the
// item somewhere, by one of six rules, and the fit's cost is what ranks it.
//
// That AND-across-tokens property is the whole design. Each extra word the
// estimator types narrows the list and never widens it, and the order the
// words come in never matters.
//
// Two layers merge at load, and the user's wins by code:
//   1. the bundled catalog shipped with the app
//   2. the user's own items, kept in this browser
// A user item with the same code as a bundled one REPLACES it, so a company
// price list overrides the generic figures without editing the shipped file.

import * as D from './dialogs.js';

const CATALOG_URL = new URL('../../data/materials_catalog.json', import.meta.url);
const USER_KEY = 'ptt.catalog.user.v1';
export const CATALOG_MAX_RESULTS = 40;

let _items = null;
let _index = null;
let _loading = null;

// ── normalisation ─────────────────────────────────────────────────────────

/** One spelling for everything that is compared. */
export function catNorm(s) {
  return String(s ?? '').toLowerCase().replaceAll('×', 'x').trim();
}

const DIMSEP = /(?<=\d)\s*[x×]\s*(?=\d)/g;   // the x between two digits
const RUNS = /\d+\/\d+|\d+|[a-z]+/g;              // fraction | digits | letters

/** The dims as one typed run: [2,4,8] → "248". What "248d" is matched against. */
function digitKey(item) {
  const out = [];
  for (const d of item.dims || []) {
    const f = Number(d);
    if (!Number.isFinite(f)) continue;
    out.push(Number.isInteger(f) ? String(f) : String(f).replace('.', ''));
  }
  return out.join('');
}

/** Every word a query token may prefix-match. */
function catWords(item) {
  const words = [];
  for (const field of [item.name, item.code, item.trade, item.group]) {
    words.push(...catNorm(field).replaceAll(',', ' ').split(/\s+/));
  }
  // A whole tag counts as one word — "simpson" must find the HDU2.
  for (const t of item.tags || []) words.push(catNorm(t));
  // "8'" in a name should match a typed 8.
  for (const w of words.slice()) {
    if (w.endsWith("'") || w.endsWith('"')) words.push(w.replace(/['"]+$/, ''));
  }
  return words.filter(Boolean);
}

export function buildIndex(items) {
  const out = [];
  for (const it of items || []) {
    if (!it || typeof it !== 'object' || !it.name) continue;
    out.push({ it, words: catWords(it), digitkey: digitKey(it), code: catNorm(it.code) });
  }
  return out;
}

/**
 * How well one token fits one item. Lower is better; null means it does not
 * fit at all, which disqualifies the item outright.
 */
function tokenScore(token, words, digitkey, codeLc) {
  if (token === codeLc) return 0;                       // the code exactly
  if (codeLc.startsWith(token)) return 1;               // a code prefix
  if (digitkey && token === digitkey) return 2;         // the dims exactly
  for (const w of words) if (w.startsWith(token)) return 3;   // a word prefix
  if (/^\d+$/.test(token) && digitkey.startsWith(token)) return 4;
  // ...so "24" finds every 2x4; keep typing to narrow it.

  // The fused shorthand: "2x4x8" → "248", "248d", "d248". The pieces may come
  // in any order — digits must lead the dims or some word, letters and
  // fractions must lead some word.
  const fused = token.replace(DIMSEP, '');
  const runs = fused.match(RUNS) || [];
  if (runs.length < 2 && fused === token) return null;
  const digits = runs.filter(r => /^\d/.test(r) && !r.includes('/')).join('');
  const alphas = runs.filter(r => !/^\d/.test(r));
  const fracs = runs.filter(r => r.includes('/'));
  if (!runs.length || (!digits && !alphas.length && !fracs.length)) return null;
  if (digits && !(digitkey.startsWith(digits) || words.some(w => w.startsWith(digits)))) {
    return null;
  }
  for (const a of alphas) if (!words.some(w => w.startsWith(a))) return null;
  for (const f of fracs) if (!words.some(w => w.startsWith(f))) return null;
  return 4;
}

/**
 * Search the index. Every token must fit, so each extra word narrows.
 * Ranked by summed score, then by name length, then alphabetically — the
 * shortest name that fits is almost always the one meant.
 */
export function search(index, query, limit = CATALOG_MAX_RESULTS) {
  const tokens = catNorm(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  const scored = [];
  for (const row of index) {
    let total = 0;
    let ok = true;
    for (const tok of tokens) {
      const sc = tokenScore(tok, row.words, row.digitkey, row.code);
      if (sc === null) { ok = false; break; }
      total += sc;
    }
    if (ok) scored.push([total, String(row.it.name || '').length, row.it]);
  }
  // The final tie-break is a CODE POINT comparison, not localeCompare.
  // Python sorts strings by code point; localeCompare uses locale collation,
  // which ignores punctuation and case differences that Python does not. Two
  // items scoring the same with the same name length would then come back in a
  // different order here than on the desktop — and the first result is what
  // the name box fills in, so that order is user-visible.
  scored.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] - b[0];
    if (a[1] !== b[1]) return a[1] - b[1];
    const na = catNorm(a[2].name), nb = catNorm(b[2].name);
    return na < nb ? -1 : na > nb ? 1 : 0;
  });
  return scored.slice(0, limit).map(s => s[2]);
}

// ── coercion ──────────────────────────────────────────────────────────────

/** A price from anywhere — a number, "5.25", "$1,200.00", or junk. */
export function catalogPrice(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
  }
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return 0;
  const f = parseFloat(s);
  return Number.isFinite(f) ? Math.round(f * 100) / 100 : 0;
}

/** Match confidence: Low, Medium or High — anything else is blank. */
export function catalogConfidence(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return { low: 'Low', medium: 'Medium', high: 'High' }[s] || '';
}

// ── load and merge ────────────────────────────────────────────────────────

function loadUserItems() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return { items: [], removed: [] };
    const d = JSON.parse(raw);
    if (Array.isArray(d)) return { items: d, removed: [] };
    return { items: d.items || [], removed: d.removed || [] };
  } catch {
    return { items: [], removed: [] };
  }
}

function saveUserItems(items, removed = []) {
  try {
    localStorage.setItem(USER_KEY, JSON.stringify({ version: 1, items, removed }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the catalog once. A failure is not fatal: the name boxes simply stop
 * suggesting, and the estimator types names by hand as they always could.
 */
export function loadCatalog() {
  if (_loading) return _loading;
  _loading = (async () => {
    let bundled = [];
    try {
      const res = await fetch(CATALOG_URL);
      if (res.ok) {
        const data = await res.json();
        bundled = Array.isArray(data) ? data : (data.items || []);
      }
    } catch { /* the bundled file is optional */ }

    const { items: userItems, removed } = loadUserItems();
    const byCode = new Map();
    const noCode = [];
    for (const it of bundled) {
      const code = catNorm(it.code);
      if (code) byCode.set(code, it); else noCode.push(it);
    }
    // The user's own item with the same code REPLACES the bundled one.
    for (const it of userItems) {
      const code = catNorm(it.code);
      if (code) byCode.set(code, { ...it, _user: true });
      else noCode.push({ ...it, _user: true });
    }
    for (const code of removed) byCode.delete(catNorm(code));

    _items = [...byCode.values(), ...noCode];
    _index = buildIndex(_items);
    populateDatalist();
    return _items.length;
  })();
  return _loading;
}

export function catalogItems() { return _items || []; }
export function catalogIndex() { return _index || []; }
export function catalogReady() { return !!_index; }

/**
 * The identity two catalog rows merge on: the code when there is one, and the
 * name plus unit when there is not. Never the empty string, which is what a
 * code-less row's code normalises to.
 */
function mergeKey(it) {
  const code = catNorm(it && it.code);
  return code || `name:${catNorm(it && it.name)}|${catNorm(it && it.unit)}`;
}

export function findByCode(code) {
  const c = catNorm(code);
  return (_items || []).find(it => catNorm(it.code) === c) || null;
}

/**
 * The <datalist> the name boxes use. A datalist is capped deliberately: the
 * browser's own dropdown is fine for a few hundred entries and unusable at
 * two thousand, and the real search runs through search() anyway.
 */
function populateDatalist() {
  let dl = document.getElementById('catalogNames');
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = 'catalogNames';
    document.body.appendChild(dl);
  }
  dl.textContent = '';
  const seen = new Set();
  for (const it of _items || []) {
    const n = String(it.name || '');
    if (!n || seen.has(n)) continue;
    seen.add(n);
    const o = document.createElement('option');
    o.value = n;
    if (it.code) o.label = it.code;
    dl.appendChild(o);
    if (seen.size >= 800) break;
  }
}

/**
 * Attach a live catalog search to a text input.
 * Returns a detach function. The chosen record is handed to `onPick`.
 */
export function attachSearch(inputEl, onPick, { limit = 12 } = {}) {
  const pop = document.createElement('div');
  pop.className = 'ctx-menu';
  pop.hidden = true;
  pop.style.maxHeight = '280px';
  pop.style.overflowY = 'auto';
  document.body.appendChild(pop);

  let rows = [];
  let active = -1;

  const render = () => {
    pop.textContent = '';
    rows.forEach((it, i) => {
      const b = document.createElement('button');
      b.innerHTML = '';
      b.textContent = `${it.name}`;
      const tag = document.createElement('span');
      tag.style.cssText = 'float:right;color:#7d7d7d;font-size:11px;margin-left:12px';
      tag.textContent = [it.code, it.unit, it.price ? `$${catalogPrice(it.price).toFixed(2)}` : '']
        .filter(Boolean).join('  ·  ');
      b.appendChild(tag);
      if (i === active) b.style.background = 'var(--accent)';
      b.addEventListener('mousedown', ev => {
        ev.preventDefault();
        choose(it);
      });
      pop.appendChild(b);
    });
    if (!rows.length) { pop.hidden = true; return; }
    const r = inputEl.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 2}px`;
    pop.style.minWidth = `${Math.max(260, r.width)}px`;
    pop.hidden = false;
  };

  const choose = it => {
    inputEl.value = it.name;
    pop.hidden = true;
    rows = []; active = -1;
    onPick?.(it);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const onInput = () => {
    if (!_index) { pop.hidden = true; return; }
    rows = search(_index, inputEl.value, limit);
    active = rows.length ? 0 : -1;
    render();
  };
  const onKey = ev => {
    if (pop.hidden || !rows.length) return;
    if (ev.key === 'ArrowDown') { active = (active + 1) % rows.length; render(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = (active - 1 + rows.length) % rows.length; render(); ev.preventDefault(); }
    else if (ev.key === 'Enter' && active >= 0) { choose(rows[active]); ev.preventDefault(); }
    else if (ev.key === 'Escape') { pop.hidden = true; }
  };
  const onBlur = () => setTimeout(() => { pop.hidden = true; }, 120);

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onKey);
  inputEl.addEventListener('blur', onBlur);

  return () => {
    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('keydown', onKey);
    inputEl.removeEventListener('blur', onBlur);
    pop.remove();
  };
}

// ── the editor ────────────────────────────────────────────────────────────

const COLUMNS = [
  ['name', 'Name', 260], ['code', 'Code', 90], ['unit', 'Unit', 70],
  ['price', 'Price', 80], ['trade', 'Trade', 110], ['group', 'Group', 140],
  ['kind', 'Kind', 80],
];

export async function openCatalog() {
  await loadCatalog();
  await D.showDialog(close => {
    const body = D.el('div');

    const bar = D.el('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:10px';
    const q = D.input('', 'text');
    q.placeholder = 'Search — try 248d, 2x4x8, simpson, 1/2 cdx…';
    q.style.cssText = 'flex:1;background:#1c1c1c;color:#dedede;border:1px solid #303030;border-radius:5px;padding:7px 9px;font:inherit';
    const count = D.el('span', 'hint');
    count.style.cssText = 'white-space:nowrap;color:#7d7d7d';
    bar.append(q, count);
    body.appendChild(bar);

    const wrap = D.el('div');
    wrap.style.cssText = 'max-height:52vh;overflow:auto;border:1px solid #2c2c2c;border-radius:6px';
    const table = D.el('table', 'grid');
    const thead = D.el('thead');
    const hr = D.el('tr');
    for (const [, label, w] of COLUMNS) {
      const th = D.el('th', null, label);
      th.style.width = `${w}px`;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tb = D.el('tbody');
    table.appendChild(tb);
    wrap.appendChild(table);
    body.appendChild(wrap);

    const draw = () => {
      const list = q.value.trim()
        ? search(_index, q.value, 300)
        : (_items || []).slice(0, 300);
      tb.textContent = '';
      for (const it of list) {
        const tr = D.el('tr');
        for (const [key] of COLUMNS) {
          let v = it[key];
          if (key === 'price') v = catalogPrice(v) ? `$${catalogPrice(v).toFixed(2)}` : '—';
          const td = D.el('td', key === 'price' ? 'num' : null, String(v ?? ''));
          if (it._user) td.style.color = '#c8d98f';
          tr.appendChild(td);
        }
        tr.title = it._user ? 'Your own item — overrides the bundled catalog' : '';
        tr.addEventListener('dblclick', () => editItem(it, draw));
        tb.appendChild(tr);
      }
      count.textContent = q.value.trim()
        ? `${list.length} match${list.length === 1 ? '' : 'es'}`
        : `${(_items || []).length.toLocaleString('en-US')} items`;
    };
    q.addEventListener('input', draw);
    draw();

    const note = D.el('div', 'hint');
    note.style.cssText = 'margin-top:8px;color:#606060';
    note.textContent =
      'Your own items are kept in this browser and override a bundled item with the same code. ' +
      'Double-click a row to edit it.';
    body.appendChild(note);

    return D.dlg({
      title: 'Materials Catalog',
      wide: true,
      body,
      buttons: [
        D.button('Add item…', '', () => editItem(null, draw)),
        D.button('Export mine…', '', exportUser),
        D.button('Import…', '', () => importUser(draw)),
        D.button('Close', 'primary', () => close(true)),
      ],
    });
  });
}

async function editItem(existing, refresh) {
  const ex = existing || {};
  const patch = await D.showDialog(close => {
    const form = D.el('div', 'form');
    const name = D.field(form, 'Name', D.input(ex.name || ''));
    const code = D.field(form, 'Code', D.input(ex.code || ''),
      'A code that matches a bundled item overrides it.');
    const unit = D.field(form, 'Unit', D.input(ex.unit || 'EA'));
    const price = D.field(form, 'Price',
      D.input(String(catalogPrice(ex.price) || ''), 'number', { step: '0.01', min: '0' }));
    const trade = D.field(form, 'Trade', D.input(ex.trade || ''));
    const group = D.field(form, 'Group', D.input(ex.group || ''));
    const kind = D.field(form, 'Kind',
      D.select([['material', 'Material'], ['labor', 'Labor']], ex.kind || 'material'));
    const dims = D.field(form, 'Dimensions', D.input((ex.dims || []).join(' x ')),
      'Numbers separated by x — 2 x 4 x 8. Used by the shorthand search.');
    const tags = D.field(form, 'Tags', D.input((ex.tags || []).join(', ')),
      'Other words that should find this item.');

    return D.dlg({
      title: existing ? 'Edit Catalog Item' : 'New Catalog Item',
      body: form,
      buttons: [
        D.button('Cancel', '', () => close(null)),
        D.button('Save', 'primary', () => {
          const n = name.value.trim();
          if (!n) { name.focus(); return; }
          close({
            name: n,
            code: code.value.trim().toUpperCase(),
            unit: unit.value.trim().toUpperCase() || 'EA',
            price: catalogPrice(price.value),
            trade: trade.value.trim(),
            group: group.value.trim(),
            kind: kind.value,
            // An empty field must not become [0] — that gives the item a
            // digitkey of "0" and makes it answer to a typed zero.
            dims: dims.value.split(/[x×,\s]+/).map(s => s.trim())
              .filter(Boolean).map(Number).filter(n => Number.isFinite(n) && n > 0),
            tags: tags.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
          });
        }),
      ],
    });
  });
  if (!patch) return;

  const { items, removed } = loadUserItems();
  // Match on the same identity the import uses, so editing a code-less item
  // updates it instead of appending a second copy every time.
  const key = mergeKey(patch);
  const idx = items.findIndex(i => mergeKey(i) === key);
  if (idx >= 0) items[idx] = patch; else items.push(patch);
  if (!saveUserItems(items, removed)) {
    await D.alertDialog('Could not save',
      'This browser would not store the catalog change. Private browsing or a full ' +
      'storage quota will do that. Export your items to keep them.');
    return;
  }
  _loading = null;
  await loadCatalog();
  refresh?.();
}

function exportUser() {
  const { items, removed } = loadUserItems();
  const blob = new Blob(
    [JSON.stringify({ version: 1, _about: 'Professional Takeoff Tools user catalog', items, removed }, null, 1)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'My Materials.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

async function importUser(refresh) {
  const file = await new Promise(res => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.json,.csv';
    i.addEventListener('change', () => res(i.files[0] || null));
    i.click();
  });
  if (!file) return;
  try {
    const text = await file.text();
    let incoming;
    if (file.name.toLowerCase().endsWith('.csv')) incoming = parseCsv(text);
    else {
      const d = JSON.parse(text);
      incoming = Array.isArray(d) ? d : (d.items || []);
    }
    const { items, removed } = loadUserItems();
    // Key on something that never collapses. Keying on the code alone mapped
    // EVERY code-less item to '', so a second import of a supplier CSV with no
    // code column silently destroyed all but one of the previous 300 rows.
    const byKey = new Map(items.map(i => [mergeKey(i), i]));
    let added = 0;
    for (const it of incoming) {
      if (!it || !it.name) continue;
      const row = { ...it, price: catalogPrice(it.price) };
      byKey.set(mergeKey(row), row);
      added += 1;
    }
    saveUserItems([...byKey.values()], removed);
    _loading = null;
    await loadCatalog();
    refresh?.();
    await D.alertDialog('Imported', `${added} item${added === 1 ? '' : 's'} imported.`);
  } catch (err) {
    await D.alertDialog('Could not import', err.message);
  }
}

/** A forgiving CSV reader: any column order, header names matched loosely. */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const split = line => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map(h => h.trim().toLowerCase());
  const col = names => head.findIndex(h => names.includes(h));
  const iName = col(['name', 'item', 'description']);
  const iCode = col(['code', 'sku', 'id']);
  const iUnit = col(['unit', 'uom']);
  const iPrice = col(['price', 'cost', 'unit price', 'unit cost']);
  const iTrade = col(['trade', 'division']);
  const iGroup = col(['group', 'category']);
  const iKind = col(['kind', 'type']);
  const out = [];
  for (const line of lines.slice(1)) {
    const c = split(line);
    const name = (c[iName] || '').trim();
    if (!name) continue;
    out.push({
      name,
      code: (c[iCode] || '').trim().toUpperCase(),
      unit: (c[iUnit] || 'EA').trim().toUpperCase(),
      price: catalogPrice(c[iPrice]),
      trade: (c[iTrade] || '').trim(),
      group: (c[iGroup] || '').trim(),
      kind: /labor/i.test(c[iKind] || '') ? 'labor' : 'material',
      dims: [], tags: [],
    });
  }
  return out;
}

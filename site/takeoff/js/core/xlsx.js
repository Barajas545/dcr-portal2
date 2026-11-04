// xlsx.js — a small, dependency-free writer for styled Excel workbooks.
//
// The desktop app's Excel export is not a data dump: it bands sections by
// colour, bolds totals, indents associated materials under their parent, and
// formats money as money. That styling is the point — an estimator hands the
// sheet to a supplier. The popular browser spreadsheet libraries either drop
// cell styles entirely or put them behind a paid build, so this writes the
// XLSX itself.
//
// An .xlsx is a ZIP of XML parts. Everything here is stored uncompressed
// (method 0), which makes the ZIP writer twenty lines instead of a deflate
// implementation, and Excel does not care. A takeoff workbook is a few hundred
// KB either way.

const te = new TextEncoder();

// ── ZIP ───────────────────────────────────────────────────────────────────

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a ZIP from [{name, data:Uint8Array}]. Stored, no compression. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = te.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);          // version needed
    dv.setUint16(6, 0, true);           // flags
    dv.setUint16(8, 0, true);           // method: stored
    dv.setUint16(10, 0, true);          // time
    dv.setUint16(12, 0x21, true);       // date (1996-01-01, a fixed stamp)
    dv.setUint32(14, crc, true);
    dv.setUint32(18, f.data.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, f.data);

    const cen = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);

    offset += local.length + f.data.length;
  }

  let centralSize = 0;
  for (const c of central) centralSize += c.length;
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

// ── XML ───────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel refuses a file containing control characters. Strip them rather
    // than writing a workbook that will not open.
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function colName(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ── styles ────────────────────────────────────────────────────────────────
//
// A style is declared once here and referenced by name from a cell. The
// palette matches the desktop export so the two workbooks look like one
// program produced them.

export const STYLES = {
  plain: {},
  bold: { bold: true },
  title: { bold: true, size: 14, color: 'FF1F3864' },
  subtitle: { size: 10, color: 'FF666666' },
  header: { bold: true, color: 'FFFFFFFF', fill: 'FF1F3864' },
  labor: { bold: true, color: 'FFF5C97A', fill: 'FF5A4410' },
  material: { bold: true, color: 'FF7AB8F5', fill: 'FF173A5E' },
  floor: { bold: true, color: 'FFFFFFFF', fill: 'FF005580' },
  category: { bold: true, color: 'FFFFFFFF', fill: 'FF2D5A27' },
  sub: { bold: true, color: 'FFFFFFFF', fill: 'FF3D3D00' },
  subtotal: { bold: true, color: 'FF1F3864', fill: 'FFDCE6F1' },
  grand: { bold: true, color: 'FFFFFFFF', fill: 'FF1F3864' },
  indent: { color: 'FF555555', indent: 2 },
  num: { numFmt: '#,##0.00' },
  numBold: { bold: true, numFmt: '#,##0.00' },
  money: { numFmt: '"$"#,##0.00' },
  moneyBold: { bold: true, numFmt: '"$"#,##0.00' },
  moneyGrand: { bold: true, numFmt: '"$"#,##0.00', color: 'FFFFFFFF', fill: 'FF1F3864' },
  int: { numFmt: '#,##0' },
};

const STYLE_ORDER = Object.keys(STYLES);
const STYLE_INDEX = Object.fromEntries(STYLE_ORDER.map((k, i) => [k, i]));

function buildStyles() {
  const numFmts = [];
  const numFmtIds = {};
  let nextFmt = 164;
  for (const key of STYLE_ORDER) {
    const f = STYLES[key].numFmt;
    if (f && !(f in numFmtIds)) {
      numFmtIds[f] = nextFmt++;
      numFmts.push(`<numFmt numFmtId="${numFmtIds[f]}" formatCode="${esc(f)}"/>`);
    }
  }

  const fonts = STYLE_ORDER.map(key => {
    const s = STYLES[key];
    return `<font><sz val="${s.size || 11}"/><name val="Calibri"/>` +
      (s.bold ? '<b/>' : '') +
      (s.color ? `<color rgb="${s.color}"/>` : '') +
      '</font>';
  });

  const fills = ['<fill><patternFill patternType="none"/></fill>',
                 '<fill><patternFill patternType="gray125"/></fill>'];
  const fillIndex = {};
  for (const key of STYLE_ORDER) {
    const c = STYLES[key].fill;
    if (c && !(c in fillIndex)) {
      fillIndex[c] = fills.length;
      fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${c}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
  }

  const xfs = STYLE_ORDER.map((key, i) => {
    const s = STYLES[key];
    const fillId = s.fill ? fillIndex[s.fill] : 0;
    const numId = s.numFmt ? numFmtIds[s.numFmt] : 0;
    const align = s.indent
      ? `<alignment indent="${s.indent}"/>`
      : '<alignment vertical="center" wrapText="0"/>';
    return `<xf numFmtId="${numId}" fontId="${i}" fillId="${fillId}" borderId="0" xfId="0"` +
      ` applyFont="1"${s.fill ? ' applyFill="1"' : ''}${s.numFmt ? ' applyNumberFormat="1"' : ''}` +
      ` applyAlignment="1">${align}</xf>`;
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="${numFmts.length}">${numFmts.join('')}</numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ── sheets ────────────────────────────────────────────────────────────────

/**
 * One cell. A value that is a number is written as a number so Excel can sum
 * it; everything else becomes an inline string.
 *   { v: any, s: styleName, span: n }   span merges n columns from here.
 */
export function cell(v, s = 'plain', span = 0) {
  return { v, s, span };
}

function sheetXml(rows, { cols = [], freeze = 0 } = {}) {
  const merges = [];
  const body = rows.map((row, r) => {
    const cells = [];
    let c = 0;
    for (const raw of row) {
      const cellObj = raw && typeof raw === 'object' && 'v' in raw ? raw : { v: raw, s: 'plain', span: 0 };
      const ref = `${colName(c)}${r + 1}`;
      const sIdx = STYLE_INDEX[cellObj.s] ?? 0;
      const v = cellObj.v;
      if (v === null || v === undefined || v === '') {
        cells.push(`<c r="${ref}" s="${sIdx}"/>`);
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        cells.push(`<c r="${ref}" s="${sIdx}"><v>${v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}" s="${sIdx}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
      }
      if (cellObj.span > 1) {
        merges.push(`<mergeCell ref="${ref}:${colName(c + cellObj.span - 1)}${r + 1}"/>`);
        // A merged run still needs its covered cells present and styled, or
        // the band shows the default fill through the gap.
        for (let k = 1; k < cellObj.span; k++) {
          cells.push(`<c r="${colName(c + k)}${r + 1}" s="${sIdx}"/>`);
        }
        c += cellObj.span;
      } else {
        c += 1;
      }
    }
    return `<row r="${r + 1}">${cells.join('')}</row>`;
  });

  const colsXml = cols.length
    ? `<cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const paneXml = freeze
    ? `<sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView>`
    : '<sheetView workbookViewId="0"/>';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews>${paneXml}</sheetViews>
${colsXml}
<sheetData>${body.join('')}</sheetData>
${merges.length ? `<mergeCells count="${merges.length}">${merges.join('')}</mergeCells>` : ''}
</worksheet>`;
}

/**
 * Build a workbook.
 * @param {Array<{name:string, rows:Array<Array>, cols?:number[], freeze?:number}>} sheets
 * @returns {Blob}
 */
export function writeWorkbook(sheets) {
  const files = [];
  const push = (name, text) => files.push({ name, data: te.encode(text) });

  push('[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`);

  push('_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

  push('xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) =>
      `<sheet name="${esc(safeSheetName(s.name))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`);

  push('xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  push('xl/styles.xml', buildStyles());
  sheets.forEach((s, i) => {
    push(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows, { cols: s.cols, freeze: s.freeze }));
  });

  return zip(files);
}

/** Excel rejects these characters in a tab name, and caps it at 31. */
function safeSheetName(name) {
  return String(name || 'Sheet').replace(/[\\/?*[\]:]/g, '-').slice(0, 31) || 'Sheet';
}

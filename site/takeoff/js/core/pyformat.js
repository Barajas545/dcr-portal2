// pyformat.js — a number as the desktop app writes it, character for character.
//
// The desktop formats with Python: format(x, '.1f'), f'{x:,.2f}', '%g',
// round(x, n), int(x). Python rounds an exact tie HALF TO EVEN on the exact
// binary value -- 12.25 -> '12.2', 0.125 -> '0.12', 2.5 -> '2' -- where
// JavaScript's toFixed, toLocaleString and Intl.NumberFormat round it away
// from zero (12.3) and Math.round rounds it up towards +infinity (-2.5 -> -2).
// The two only differ on a value that IS a tie in binary, and real takeoff
// makes them: a 3.5 ft x 3.5 ft square is exactly 12.25 sq ft.
//
// So every number this app shows or writes into a file as TEXT goes through
// one of these, and the same number reads the same on both screens (the
// user's decision of 2026-11-07: "match the desktop rounding"). A number with
// no desktop counterpart uses them too, so no screen shows one number two
// ways. tests/rounding-parity.mjs holds them to Python's own format() and
// fails any new toFixed / toLocaleString / Math.round that reaches text.
//
// Pure: no imports, nothing touches the DOM.

/**
 * The exact decimal digits of |x| (finite), as [intDigits, fracDigits].
 *
 * toFixed(100) is exact for every double from 2^-14 up to 1e21: such a
 * double has at most 66 decimal places. From 1e21 on it returns exponent
 * notation ('1e+21') where Python prints every digit, and below 2^-14 it
 * rounds away the 100th place on -- all of a tiny number's significant
 * digits, which '%g' shows. Those two are taken from the bits instead: a
 * double is m * 2^e, which is m * 5^-e / 10^-e exactly.
 */
function exactDigits(x) {
  const a = Math.abs(x);
  if (a >= 2 ** -14 && a < 1e21) {
    const [i, f = ''] = a.toFixed(100).split('.');
    return [i, f.replace(/0+$/, '')];
  }
  if (a === 0) return ['0', ''];
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, a);
  const hi = dv.getUint32(0), lo = dv.getUint32(4);
  const bexp = (hi >>> 20) & 0x7ff;
  let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let e;
  if (bexp === 0) e = -1074;                  // subnormal
  else { m |= 1n << 52n; e = bexp - 1075; }
  if (e >= 0) return [(m << BigInt(e)).toString(), ''];
  const s = (m * 5n ** BigInt(-e)).toString().padStart(-e + 1, '0');
  const i = s.slice(0, s.length + e);
  return [i, s.slice(s.length + e).replace(/0+$/, '')];
}

/** '1234567' -> '1,234,567' (Python's ',' option). */
function group(intDigits) {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Python's text for a value that is not a finite number. */
function nonFinite(x) {
  if (Number.isNaN(x)) return 'nan';
  return x < 0 ? '-inf' : 'inf';
}

/**
 * Round a digit string half to even at `keep` digits.
 * Returns the kept digits (one longer when a carry runs off the front).
 */
function roundDigits(digits, keep) {
  const kept = digits.slice(0, keep).padEnd(keep, '0').split('').map(Number);
  const rest = digits.slice(keep);
  const first = rest.length ? Number(rest[0]) : 0;
  const tail = /[1-9]/.test(rest.slice(1));
  let up = first > 5 || (first === 5 && tail);
  if (first === 5 && !tail) up = kept.length ? kept[kept.length - 1] % 2 === 1 : false;
  if (up) {
    let k = kept.length - 1;
    while (k >= 0 && kept[k] === 9) { kept[k] = 0; k -= 1; }
    if (k < 0) kept.unshift(1); else kept[k] += 1;
  }
  return kept.join('');
}

/** Python format(x, '.Nf'), or ',.Nf' with `commas`: half to even. */
export function pyFixed(x, nd, commas = false) {
  x = Number(x);
  if (!Number.isFinite(x)) return nonFinite(x);
  nd = Math.max(0, Math.trunc(nd) || 0);
  const neg = x < 0 || Object.is(x, -0);
  const [ip, fp] = exactDigits(x);
  const all = roundDigits(ip + fp, ip.length + nd);
  let intPart = all.slice(0, all.length - nd).replace(/^0+(?=\d)/, '') || '0';
  const frac = nd ? all.slice(all.length - nd) : '';
  if (commas) intPart = group(intPart);
  return (neg ? '-' : '') + intPart + (nd ? `.${frac}` : '');
}

/** Python round(x, nd) -- the double nearest the half-even decimal. */
export function pyRound(x, nd = 0) {
  x = Number(x);
  if (!Number.isFinite(x)) return x;
  const r = Number(pyFixed(x, nd));
  // round() keeps the sign of a zero (round(-0.4) is -0.0)
  return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r;
}

/** Python round(x) with no digits: an int, half to even (an int has no -0). */
export function pyRoundInt(x) {
  const r = pyRound(x, 0);
  return r === 0 ? 0 : r;
}

/** Python int(x): towards zero, as a whole number (no -0). */
export function pyInt(x) {
  const r = Math.trunc(Number(x));
  return r === 0 ? 0 : r;
}

/** '%d' / '{:,}' of a whole number, every digit (Python's int prints them all). */
export function pyIntStr(n, commas = false) {
  n = Number(n);
  if (!Number.isFinite(n)) return nonFinite(n);
  n = pyInt(n);
  const neg = n < 0;
  const d = Math.abs(n) > Number.MAX_SAFE_INTEGER ? BigInt(Math.abs(n)).toString() : String(Math.abs(n));
  return (neg ? '-' : '') + (commas ? group(d) : d);
}

/**
 * Python format(x, '.pg') -- 'g' is p = 6. Significant digits rounded half to
 * even on the exact value; then fixed when -4 <= exponent < p, else
 * 'd.ddde+XX'; insignificant zeros and a bare point dropped.
 */
export function pyG(x, p = 6) {
  x = Number(x);
  if (!Number.isFinite(x)) return nonFinite(x);
  p = Math.max(1, Math.trunc(p) || 0);
  const sign = (x < 0 || Object.is(x, -0)) ? '-' : '';
  if (x === 0) return `${sign}0`;
  const [ip, fp] = exactDigits(x);
  const all = ip + fp;
  const lead = all.search(/[1-9]/);
  let exp = ip.length - lead - 1;
  let digits = roundDigits(all.slice(lead), p);
  if (digits.length > p) { digits = digits.slice(0, p); exp += 1; }
  let body;
  if (exp >= -4 && exp < p) {
    if (exp >= 0) body = `${digits.slice(0, exp + 1)}.${digits.slice(exp + 1)}`;
    else body = `0.${'0'.repeat(-exp - 1)}${digits}`;
    // (a point is always there to strip back to: exp + 1 <= p digits before it)
    body = body.replace(/\.?0+$/, '').replace(/\.$/, '');
  } else {
    const m = `${digits[0]}.${digits.slice(1)}`.replace(/\.?0+$/, '').replace(/\.$/, '');
    body = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return sign + body;
}

/**
 * Python str(x) of a float: the shortest digits that read back as x (as
 * JavaScript's own), written Python's way -- '10.0', '1e-05', '1e+16'.
 */
export function pyStrFloat(x) {
  x = Number(x);
  if (!Number.isFinite(x)) return nonFinite(x);
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const sign = x < 0 ? '-' : '';
  const [m, e] = Math.abs(x).toExponential().split('e');
  const digits = m.replace('.', '');
  const exp = Number(e);
  if (exp < -4 || exp >= 16) {
    const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${mant}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  if (exp < 0) return `${sign}0.${'0'.repeat(-exp - 1)}${digits}`;
  const ip = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
  const fp = digits.slice(exp + 1);
  return `${sign}${ip}.${fp || '0'}`;
}

/** The desktop's money: f"${x:,.2f}" (so a credit reads '$-5.00', as there; nothing at all is $0.00). */
export function pyMoney(x) {
  return `$${pyFixed(x === null || x === undefined ? 0 : Number(x), 2, true)}`;
}

/**
 * The desktop's quantity in a report (ReportCenterDialog._fmt_qty):
 * f"{q:,.2f}".rstrip("0").rstrip(".") if q else "0".
 */
export function pyQty(q) {
  if (q === null || q === undefined) return '0';
  q = Number(q);
  if (q === 0) return '0';
  return pyFixed(q, 2, true).replace(/0+$/, '').replace(/\.$/, '');
}

/** The zoom readout's number (update_zoom_label): f"{int(zoom * 100)}%" -- it TRUNCATES. */
export function pyZoomPercent(zoom) {
  return `${pyIntStr(pyInt(Number(zoom) * 100))}%`;
}

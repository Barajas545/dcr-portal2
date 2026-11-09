// py-json.js — the desktop's JSON, read and written as Python's json module does.
//
// The desktop writes a project's metadata with json.dumps(...) and reads it
// back with json.loads (pdf_fast_viewer.py: the save's
// `json.dumps(self._build_save_metadata())`, load_cache_to_ram's
// `json.loads(...)`). Python's json module has allow_nan on by default, so a
// float that is not finite is written as a bare word -- Infinity, -Infinity,
// NaN -- and read back as that float. The desktop makes one: a vertical
// pitch line's rise is float("inf") (_pitch_from_points), and the line is
// stored with `"value": Infinity`.
//
// Those words are not JSON. JSON.parse refuses the WHOLE block over one of
// them ("Unexpected token 'I'"), so a job holding a vertical pitch line could
// not be opened here at all; and JSON.stringify writes a non-finite number as
// null, which the desktop reads back as None where it kept a float.
//
// So, exactly where Python's json.loads accepts them -- as a value, at any
// depth, never inside a string and never as a key -- this reads the three
// words as the three numbers; and this writes every non-finite number back
// in Python's spelling. Everything else is JSON.parse and JSON.stringify
// themselves:
//
//   · a block with none of the words parses by one plain JSON.parse, the
//     same call and the same result as before -- the other path is reached
//     only when that call has already refused the text;
//   · a value holding no non-finite number is written by one plain
//     JSON.stringify, byte for byte what a save wrote before.
//
// tests/py-json.mjs holds both to Python's own json.dumps and json.loads
// (tests/data/py-json-truth.json, from tests/py-json-python-truth.py).
//
// Pure: no imports, nothing touches the DOM.

/** Python's spelling of a number that is not finite (json.dumps, allow_nan). */
export function pyJsonWord(x) {
  if (x !== x) return 'NaN';
  return x > 0 ? 'Infinity' : '-Infinity';
}

// ── reading ──────────────────────────────────────────────────────────────

/**
 * Where the three words stand outside strings in `text`: [start, end,
 * number] for each, in order; null when there is none; and KEY when one
 * stands where a key does -- followed by a ':' -- which Python's json.loads
 * refuses whatever comes after ({NaN: 1}, and {"a": {NaN: 1}, "a": 2} too,
 * whose object a later "a" would have thrown away). A word inside a string
 * is part of that string ("Infinity" the name, "NaN" a note) and is left
 * alone.
 *
 * The string state is followed quote to quote with indexOf, never character
 * by character: inside a string a quote ends it unless an odd run of
 * backslashes stands before it. This runs only after JSON.parse has refused
 * the text, so it is never the cost of an ordinary open.
 */
const KEY = 'key';
function bareWords(text) {
  const at = [];
  for (const word of ['Infinity', 'NaN']) {
    for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + word.length)) at.push(i);
  }
  if (!at.length) return null;
  at.sort((a, b) => a - b);
  const out = [];
  let pos = 0;
  let inString = false;
  for (const c of at) {
    for (;;) {
      const q = text.indexOf('"', pos);
      if (q === -1 || q >= c) break;
      if (!inString) {
        inString = true;
      } else {
        let slashes = 0;
        while (text.charCodeAt(q - 1 - slashes) === 92) slashes += 1;
        if (slashes % 2 === 0) inString = false;
      }
      pos = q + 1;
    }
    if (inString) continue;
    const end = c + (text.charCodeAt(c) === 73 ? 8 : 3);     // 'I'nfinity, or NaN
    if (text.charCodeAt(afterSpace(text, end)) === 58) return KEY;   // ':'
    if (end === c + 8) {
      // Python reads '-Infinity' as one word; a '-' before 'NaN' it refuses.
      const neg = c > 0 && text.charCodeAt(c - 1) === 45;  // '-'
      out.push([neg ? c - 1 : c, end, neg ? -Infinity : Infinity]);
    } else {
      out.push([c, end, NaN]);
    }
  }
  return out.length ? out : null;
}

/** The first index at or after `i` that is not JSON's whitespace (space, tab, CR, LF -- Python's json reads the same four). */
function afterSpace(text, i) {
  for (;;) {
    const ch = text.charCodeAt(i);
    if (ch !== 32 && ch !== 9 && ch !== 10 && ch !== 13) return i;
    i += 1;
  }
}

function nonce() {
  let s = '';
  try {
    const b = new Uint8Array(12);
    globalThis.crypto.getRandomValues(b);
    for (const x of b) s += x.toString(36).padStart(2, '0');
  } catch {
    for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 2 ** 40).toString(36);
  }
  return `ptt-nan-${s}`;
}

/**
 * Text -> value, as Python's json.loads reads it: JSON, and the words
 * NaN, Infinity and -Infinity where a value stands.
 *
 * Each infinity is put back as a number JSON already reads as one -- 1e999
 * is Infinity to JSON.parse and inf to Python alike -- with a space either
 * side, so a word run into its neighbour ('1Infinity', 'Infinity5') stays as
 * unreadable as Python finds it. NaN has no such number: it goes in as a
 * string the text does not hold, and is put back over the parsed value.
 *
 * A text it cannot read throws JSON.parse's own error for the text as it is
 * -- its position and its snippet are the file's, never the rewritten
 * text's, whatever the words did.
 */
export function parsePyJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    const s = String(text);
    const words = bareWords(s);
    if (!words || words === KEY) throw err;
    const value = parseWithWords(s, words);
    if (value === UNREAD) throw err;
    return value;
  }
}

const UNREAD = Symbol('unread');

function parseWithWords(text, words) {
  const nans = words.filter(w => w[2] !== w[2]).length;
  for (let attempt = 0; attempt < 8; attempt++) {
    const mark = nonce();
    if (nans && text.includes(mark)) continue;
    const parts = [];
    let from = 0;
    for (const [a, b, x] of words) {
      parts.push(text.slice(from, a));
      parts.push(x !== x ? ` "${mark}" ` : x > 0 ? ' 1e999 ' : ' -1e999 ');
      from = b;
    }
    parts.push(text.slice(from));
    let value;
    try {
      value = JSON.parse(parts.join(''));
    } catch {
      return UNREAD;
    }
    if (!nans) return value;
    const { values, keys } = putBackNaN(value, mark);
    // FEWER than were put in is a NaN under a key written again later in the
    // same object, which json.loads reads too, keeping the last one ({"a":
    // NaN, "a": 1} is {'a': 1}). MORE, or the mark as a key, is only a string
    // of the text's own that reads as the mark through its escapes: another
    // mark. (A word itself as a key has been refused already: bareWords.)
    if (values > nans || keys) continue;
    return value === mark ? NaN : value;
  }
  return UNREAD;
}

/** Every value equal to `mark` becomes NaN; counts those and the keys equal to it. */
function putBackNaN(root, mark) {
  let values = root === mark ? 1 : 0;
  let keys = 0;
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (v === null || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (x === mark) { v[i] = NaN; values += 1; } else if (x !== null && typeof x === 'object') stack.push(x);
      }
      continue;
    }
    for (const k of Object.keys(v)) {
      if (k === mark) keys += 1;
      const x = v[k];
      if (x === mark) {
        values += 1;
        // A key "__proto__" is an own key of a parsed object; assigning to it
        // would set the prototype instead.
        if (k === '__proto__') {
          Object.defineProperty(v, k, { value: NaN, enumerable: true, writable: true, configurable: true });
        } else {
          v[k] = NaN;
        }
      } else if (x !== null && typeof x === 'object') {
        stack.push(x);
      }
    }
  }
  return { values, keys };
}

// ── writing ──────────────────────────────────────────────────────────────

/**
 * Could JSON.stringify(value) meet a number that is not finite? A plain
 * walk of what it would visit: arrays, and the own enumerable keys of
 * everything else. Something with a toJSON of its own cannot be seen into,
 * so it answers yes -- the careful path is exact either way.
 */
function mayHoldNonFinite(root) {
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return true;
      continue;
    }
    if (v === null || typeof v !== 'object') continue;
    if (typeof v.toJSON === 'function') return true;
    if (v instanceof Number) {
      if (!Number.isFinite(v.valueOf())) return true;
      continue;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (typeof x === 'number') { if (!Number.isFinite(x)) return true; } else if (x !== null && typeof x === 'object') stack.push(x);
      }
      continue;
    }
    for (const k of Object.keys(v)) {
      const x = v[k];
      if (typeof x === 'number') { if (!Number.isFinite(x)) return true; } else if (x !== null && typeof x === 'object') stack.push(x);
    }
  }
  return false;
}

/**
 * Value -> text, as JSON.stringify writes it, except that a number that is
 * not finite is written as Python's json.dumps writes it -- Infinity,
 * -Infinity, NaN -- where JSON.stringify would write null. With none in it,
 * this IS JSON.stringify(value).
 */
export function stringifyPyJson(value) {
  if (!mayHoldNonFinite(value)) return JSON.stringify(value);
  for (let attempt = 0; attempt < 8; attempt++) {
    const mark = nonce();
    const mk = { Infinity: `${mark}i`, '-Infinity': `${mark}m`, NaN: `${mark}n` };
    let made = 0;
    const text = JSON.stringify(value, function replacer(_key, v) {
      const n = v instanceof Number ? v.valueOf() : v;
      if (typeof n === 'number' && !Number.isFinite(n)) {
        made += 1;
        return mk[pyJsonWord(n)];
      }
      return v;
    });
    if (text === undefined) return text;
    let found = 0;
    const out = text.replace(new RegExp(`"${mark}([imn])"`, 'g'), (_m, c) => {
      found += 1;
      return c === 'i' ? 'Infinity' : c === 'm' ? '-Infinity' : 'NaN';
    });
    // A string of the value's own read as the mark: try another.
    if (found === made) return out;
  }
  throw new Error('This metadata could not be written');
}

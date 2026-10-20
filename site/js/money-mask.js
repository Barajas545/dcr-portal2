/* Amounts typed into free text, for people without the prices switch, and money display.

   A port of DCR Desktop 2's dcrdesk/domain/money.py (mask_amounts, fmt). The two share test
   vectors (tests/vectors/money-mask.json and file-names.json are computed by the Python code), so a
   note reads the same in the office and on a phone.

   Masking is DISPLAY ONLY (BLUEPRINT 2.1 principle 8, owner answer Q28): the unmasked text still
   reaches the browser. It hides amounts from honest use, nothing more.

   Python's `re` is Unicode-aware where JavaScript's is not, so the classes are spelled out:
     \w  -> [\p{L}\p{N}_]        \d -> \p{Nd}
     \s  -> Python's whitespace (str.isspace)
     \b after k/m -> "no word character follows"                                        */

export const HIDDEN_AMOUNT = "(amount hidden)";
export const DASH = "—";

const WS = "[\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]";
const WORD = "[\\p{L}\\p{N}_]";

// "$1,250", "$ 45.50", "-$300", "$12k", "US$5" (a short currency prefix goes with it).
// Python's pattern starts with a look-behind: no word character and no "$" right before.
// Safari before 16.4 (iPhones that stay on iOS 15 or early 16) refuses a look-behind when the
// module loads, which would stop every page there, so that one condition is checked in code
// instead: a start the look-behind would refuse is skipped and the search goes on one character
// later, exactly as the regular expression engine would (shared vectors: tests/vectors/money-mask.json).
const AMOUNT = new RegExp(
  "(?:[A-Z]{1,3})?-?\\$" + WS + "?" +
  "(?:\\p{Nd}{1,3}(?:,\\p{Nd}{3})+|\\p{Nd}+)(?:[.,]\\p{Nd}+)?" +
  "(?:" + WS + "?[kKmM](?!" + WORD + "))?",
  "gu"
);
const NOT_BEFORE = /^[\p{L}\p{N}_$]$/u;

/** The character (code point) right before index i. */
function charBefore(s, i) {
  if (i <= 0) return "";
  const lo = s.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = s.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return s.slice(i - 2, i);
  }
  return s[i - 1];
}

/** Every dollar amount in `text` reads "(amount hidden)". An amount right inside parentheses loses
    its own: "hold-downs ($1,240 at Simpson)" -> "hold-downs (amount hidden at Simpson)". */
export function maskAmounts(text) {
  const s = text === null || text === undefined ? "" : String(text);
  let out = "";
  let last = 0;
  let from = 0;
  for (;;) {
    AMOUNT.lastIndex = from;
    const m = AMOUNT.exec(s);
    if (!m) break;
    const start = m.index;
    if (NOT_BEFORE.test(charBefore(s, start))) {   // the look-behind: try again one character on
      from = start + 1;
      continue;
    }
    const end = start + m[0].length;
    const before = start > 0 ? s[start - 1] : "";
    const after = end < s.length ? s[end] : "";
    out += s.slice(last, start) + (before === "(" || after === ")" ? "amount hidden" : HIDDEN_AMOUNT);
    last = from = end;
  }
  return last === 0 ? s : out + s.slice(last);
}

/* ── money values ─────────────────────────────────────────────────────── */

/** "1,234", "$1,234.50", "(12.50)", 12 -> number; blanks and spreadsheet errors -> null. */
export function parseMoney(v) {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || s.startsWith("#")) return null;
  const negative = s.startsWith("(") && s.endsWith(")");
  if (negative) s = s.slice(1, -1);
  s = s.replace(/[\s$,]/g, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  const f = Number(s);
  if (!Number.isFinite(f)) return null;
  return negative ? -f : f;
}

/* Half-up to cents on the DECIMAL text of the number (Python's Decimal(repr(f))), so 1.005 is
   $1.01 as in Access and Desktop 2, not $1.00 as binary rounding would give. Returns integer cents. */
function toCents(f) {
  let t = String(Math.abs(f));
  if (/e/i.test(t)) t = Math.abs(f).toFixed(12);
  const [whole, frac = ""] = t.split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = BigInt(whole) * 100n + BigInt(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1n;
  return f < 0 ? -cents : cents;
}

/** "$1,234.56" / "-$1,234.56"; null -> "" (or the dash when blankZero). */
export function fmtMoney(v, blankZero = false) {
  const f = parseMoney(v);
  if (f === null) return blankZero ? DASH : "";
  const cents = toCents(f);
  if (cents === 0n) return blankZero ? DASH : "$0.00";
  const abs = cents < 0n ? -cents : cents;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = "$" + dollars + "." + (abs % 100n).toString().padStart(2, "0");
  return cents < 0n ? "-" + text : text;
}

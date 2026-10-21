/* Amounts out of text that is WRITTEN for everybody (the database's app.scrub_money, migration M4
   20261023000100_agents_core.sql): every amount becomes "[amount]".

   The old portal's scrubMoney (lib/assistant.js) byte for byte - the rule DCR Desktop 2's database keeps in
   app.scrub_money and DCR Desktop 2's domain/money.py scrub_money copies (tests/vectors/scrub-money.json, computed
   by the old code, checks all three). Portal 2 uses it where a page itself composes words that are stored and read
   by everyone - the progress chart's quick note names its item "[Shear walls [amount] extra] …" for every role, so
   no amount typed into an item's name lands in the project log (P5 check 5), and no display-only mask either.

   Display masking (what one person sees on screen) stays money-mask.js maskAmounts. No look-behind (Safari before
   16.4 refuses one at load): \b does the work, as in the old code. */

const MONEY = /(?:US)?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?|\b\d[\d,]*(?:\.\d+)?\s?(?:dollars|usd|bucks)\b|\b(?:usd|dollars)\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/gi;
const MONEY_WORDS = "(?:deposits?|paid|payments?|balance|invoiced?|invoices|owes?|owed|costs?|price[ds]?|bid|budget|charged|refund(?:ed)?)";
const AMOUNT = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d{3,}(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s?[kK]\\b)";
const MONEY_NEAR = new RegExp("\\b" + MONEY_WORDS + "\\b(?:\\s+(?:us|them|him|her|me|you|of|for|was|is|at|=|:)){0,2}\\s*" + AMOUNT +
  "|\\b" + AMOUNT + "\\s+(?:in\\s+)?" + MONEY_WORDS + "\\b", "gi");

/** Every amount in `text` -> "[amount]" (null / undefined read as ""). */
export function scrubMoney(text) {
  return String(text === null || text === undefined ? "" : text).replace(MONEY, "[amount]").replace(MONEY_NEAR, "[amount]");
}

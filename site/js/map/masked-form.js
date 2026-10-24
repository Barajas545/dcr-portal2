/* Edit forms over words people typed, for a person without the prices switch (BLUEPRINT 2.1 principle 8, Q28; the rule
   of Desktop 2 and of the project Overview tab, pages/project-overview.js): a box whose words quote an amount is shown
   MASKED and READ-ONLY, and the form never sends it, so the masked copy ("(amount hidden)") is never saved over the
   words. Every other box is as typed. For a person with prices `mask` is the identity, so nothing is ever locked.
   Display only, as everywhere: the words themselves still reach the browser.

   * boxOf(text, mask)                -> {value, locked}: what the box shows and whether it is read-only;
   * fill(input, text, mask)          draws one box (value, disabled, a title saying why) and remembers the lock on the
                                      element (data-masked); -> locked;
   * valueOf(input, original)         what the form sends for the box: the ORIGINAL words while it is locked, else
                                      what is in it (an unchanged box is then left out by the writers' "what moved").
   Pure but for the two DOM helpers, which only touch the element they are given (node tests use plain objects). */

export const LOCKED_TITLE = "Contains an amount — hidden for you";

function txt(v) { return v === null || v === undefined ? "" : String(v); }

export function boxOf(text, mask) {
  const s = txt(text);
  const shown = typeof mask === "function" ? txt(mask(s)) : s;
  const locked = !!s && shown !== s;
  return { value: locked ? shown : s, locked };
}

export function fill(input, text, mask) {
  const b = boxOf(text, mask);
  input.value = b.value;
  input.disabled = b.locked;
  if (input.dataset) input.dataset.masked = b.locked ? "1" : "";
  input.title = b.locked ? LOCKED_TITLE : "";
  return b.locked;
}

export function valueOf(input, original) {
  if (input && input.dataset && input.dataset.masked === "1") return txt(original);
  return input ? input.value : "";
}

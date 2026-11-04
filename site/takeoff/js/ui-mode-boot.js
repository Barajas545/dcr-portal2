/* The layout must be decided BEFORE the stylesheet paints, or the app flashes
   the wrong one on every launch. A classic script, loaded blocking in the
   page's <head> just before the stylesheet (index.html) — so it runs before
   the first paint, as the inline script it used to be did. It is a file of
   its own because the portal's copy of this app (inside the portal on a phone
   or a tablet) is held to a page policy that allows no inline script at all.
   Tiny, and duplicated from resolveUiMode() in js/ui/settings.js on purpose:
   a module import cannot run this early, and the two are one line each.
   Touch unless standard was chosen. Not a module: no import, no export. */
try {
  var st = JSON.parse(localStorage.getItem('ptt.settings.v1') || '{}');
  document.documentElement.dataset.ui = st.ui_mode === 'standard' ? 'standard' : 'touch';
} catch (e) {
  document.documentElement.dataset.ui = 'touch';
}

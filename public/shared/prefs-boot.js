/* Runs before the page is painted, so the saved theme, text size and contrast never flash or shift the layout.
   A classic script (not a module) on purpose: it must block. Keep the lists and the theme rule in step with
   prefs.js (tests/prefs.test.js checks this file against it). With no saved choice the theme follows the device. */
(function () {
  var root = document.documentElement;
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('fairshift.prefs'));
  } catch (error) {
    /* storage blocked or corrupt: the defaults apply */
  }
  var themePref = saved && ['light', 'dark'].indexOf(saved.theme) >= 0 ? saved.theme : 'system';
  var query = null;
  try {
    query = window.matchMedia('(prefers-color-scheme: dark)');
  } catch (error) {
    /* no matchMedia: light */
  }
  function theme() {
    return themePref === 'system' ? (query && query.matches ? 'dark' : 'light') : themePref;
  }
  root.dataset.themePref = themePref;
  root.dataset.theme = theme();
  if (saved && ['large', 'xlarge'].indexOf(saved.textSize) >= 0) root.dataset.textSize = saved.textSize;
  if (saved && saved.contrast === 'high') root.dataset.contrast = 'high';
  /* While "system" is chosen, follow the device if it switches (sunset, a setting) without a reload. */
  if (query && query.addEventListener) {
    query.addEventListener('change', function () {
      if (root.dataset.themePref === 'system') root.dataset.theme = query.matches ? 'dark' : 'light';
    });
  }
})();

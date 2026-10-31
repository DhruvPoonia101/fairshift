/* Runs before the page is painted, so the saved text size and contrast never flash or shift the layout.
   A classic script (not a module) on purpose: it must block. Keep the lists in step with prefs.js
   (tests/prefs.test.js checks this file against it). There is one light theme, so nothing here touches colours:
   an old saved "dark" choice is ignored. */
(function () {
  var root = document.documentElement;
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem('fairshift.prefs'));
  } catch (error) {
    /* storage blocked or corrupt: the defaults apply */
  }
  if (saved && ['large', 'xlarge'].indexOf(saved.textSize) >= 0) root.dataset.textSize = saved.textSize;
  if (saved && saved.contrast === 'high') root.dataset.contrast = 'high';
})();

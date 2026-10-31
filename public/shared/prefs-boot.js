/* Runs before the page is painted, so saved text size and contrast never flash or shift the layout.
   A classic script (not a module) on purpose: it must block. Keep the two lists in step with prefs.js. */
(function () {
  try {
    var saved = JSON.parse(localStorage.getItem('fairshift.prefs'));
    var root = document.documentElement;
    if (saved && ['large', 'xlarge'].indexOf(saved.textSize) >= 0) root.dataset.textSize = saved.textSize;
    if (saved && saved.contrast === 'high') root.dataset.contrast = 'high';
  } catch (error) {
    /* storage blocked or corrupt: the defaults apply */
  }
})();

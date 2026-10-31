// Shows the newest Mac and TV versions on /download. /download/latest.json and
// /download/tv-latest.json come from the update feeds (the same files the apps read; see
// functions/download/). Without them, the page keeps its text and the links work.
(function () {
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function released(date) {
    var d = date ? new Date(date) : null;
    return d && !isNaN(d) ? ', released ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : '';
  }
  function showNotes(notes, listId, boxId) {
    var list = document.getElementById(listId);
    if (!list) return;
    String(notes || '').split('\n').forEach(function (raw) {
      var text = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
      if (!text || /^#/.test(text)) return;
      var li = document.createElement('li');
      li.textContent = text;
      list.appendChild(li);
    });
    if (list.children.length) document.getElementById(boxId).hidden = false;
  }
  function load(url, show) {
    fetch(url, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (feed) { if (feed) show(feed); })
      .catch(function () {});
  }
  load('/download/latest.json', function (feed) {
    if (typeof feed.version !== 'string') return;
    document.getElementById('mac-version').textContent = 'Version ' + feed.version + released(feed.pub_date) + '. Signed and notarized by Apple.';
    showNotes(feed.notes, 'mac-notes-list', 'mac-notes');
  });
  load('/download/tv-latest.json', function (feed) {
    if (typeof feed.versionName !== 'string') return;
    var size = typeof feed.size === 'number' ? ', ' + Math.round(feed.size / 1e6) + ' MB' : '';
    document.getElementById('tv-version').textContent = 'Version ' + feed.versionName + released(feed.pub_date) + size + '.';
    showNotes(feed.notes, 'tv-notes-list', 'tv-notes');
  });
})();

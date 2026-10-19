// Shows the newest Mac version on /download. nginx serves /download/latest.json from the update
// feed (the same file the app reads). Without it, the page keeps its text and the link works.
(function () {
  var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  fetch('/download/latest.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (feed) {
      if (!feed || typeof feed.version !== 'string') return;
      var line = 'Version ' + feed.version;
      var d = feed.pub_date ? new Date(feed.pub_date) : null;
      if (d && !isNaN(d)) line += ', released ' + d.getUTCDate() + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
      document.getElementById('mac-version').textContent = line + '. Signed and notarized by Apple.';
      var list = document.getElementById('mac-notes-list');
      String(feed.notes || '').split('\n').forEach(function (raw) {
        var text = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
        if (!text || /^#/.test(text)) return;
        var li = document.createElement('li');
        li.textContent = text;
        list.appendChild(li);
      });
      if (list.children.length) document.getElementById('mac-notes').hidden = false;
    })
    .catch(function () {});
})();

// The logic of the /join page, with no DOM, so it has unit tests
// (src/invite/__tests__/join-page.test.ts). The browser gets it as
// window.ZoggyfinJoin; Node gets it with require().
(function (root) {
  'use strict';

  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var PACKAGE = 'com.zogtech.zoggyfin';

  // base64url to bytes; null when a character is not base64url.
  function base64UrlBytes(text) {
    var out = [];
    var buf = 0;
    var bits = 0;
    for (var i = 0; i < text.length; i++) {
      var v = B64.indexOf(text.charAt(i));
      if (v < 0) return null;
      buf = ((buf << 6) | v) & 0xffffff;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buf >> bits) & 0xff);
      }
    }
    return out;
  }

  // Strict UTF-8; null on a bad sequence.
  function utf8(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; ) {
      var b = bytes[i];
      var n = b < 0x80 ? 0 : b >= 0xc2 && b < 0xe0 ? 1 : b >= 0xe0 && b < 0xf0 ? 2 : b >= 0xf0 && b < 0xf5 ? 3 : -1;
      if (n < 0 || i + n >= bytes.length + (n ? 0 : 1)) return null;
      var cp = n === 0 ? b : b & (0x3f >> n);
      for (var k = 1; k <= n; k++) {
        var c = bytes[i + k];
        if ((c & 0xc0) !== 0x80) return null;
        cp = (cp << 6) | (c & 0x3f);
      }
      s += String.fromCodePoint(cp);
      i += n + 1;
    }
    return s;
  }

  function str(v, max) {
    return typeof v === 'string' ? v.slice(0, max).trim() : '';
  }

  // What the page shows of an invite. It never returns the one-time password.
  function readInvite(payload) {
    if (typeof payload !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(payload)) return null;
    var bytes = base64UrlBytes(payload);
    var text = bytes && utf8(bytes);
    if (!text) return null;
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || data.v !== 1 || !str(data.sn, 100) || !str(data.u, 128) || !Array.isArray(data.a) || !data.a.length) return null;
    var labels = data.a.map(function (x) { return Array.isArray(x) ? x[1] : ''; });
    var tunnel = null;
    if (labels.every(function (l) { return l === 't' || l === 'v'; })) {
      tunnel = labels.every(function (l) { return l === 't'; }) ? 'tailscale' : 'vpn';
    }
    return { server: str(data.sn, 100), user: str(data.u, 128), inviter: str(data.by, 100), tunnel: tunnel };
  }

  // 'ios' (iPhone and iPad, also iPadOS with a desktop user agent), 'android', 'mac' or 'other'.
  function detectPlatform(ua, maxTouchPoints) {
    ua = ua || '';
    if (/iPhone|iPod|iPad/.test(ua)) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    if (/Macintosh|Mac OS X/.test(ua)) return (maxTouchPoints || 0) > 1 ? 'ios' : 'mac';
    return 'other';
  }

  // The one big button for the platform, or null when there is none (show all options).
  function primaryAction(platform, config) {
    config = config || {};
    if (platform === 'ios') {
      if (config.appStoreUrl) return { label: 'Get Zoggyfin', url: config.appStoreUrl, note: '' };
      return { label: 'Get Zoggyfin', url: config.testFlightUrl, note: 'The beta is on TestFlight. Install the TestFlight app from the App Store first.' };
    }
    if (platform === 'android') return config.androidUrl ? { label: 'Get Zoggyfin', url: config.androidUrl, note: '' } : null;
    if (platform === 'mac') return config.macUrl ? { label: 'Get Zoggyfin for Mac', url: config.macUrl, note: 'For Macs with Apple silicon and macOS 13 or later.' } : null;
    return config.webAppUrl ? { label: 'Open Zoggyfin in the browser', url: config.webAppUrl, note: '' } : null;
  }

  // The "Open in Zoggyfin" link. Android Chrome needs an intent link: the
  // fragment of an intent link holds the intent fields, so the invite goes in the path.
  function openUrl(platform, payload, fallbackUrl) {
    if (platform === 'android') {
      var fallback = fallbackUrl ? ';S.browser_fallback_url=' + encodeURIComponent(fallbackUrl) : '';
      return 'intent://join/' + payload + '#Intent;scheme=zoggyfin;package=' + PACKAGE + fallback + ';end';
    }
    return 'zoggyfin://join#' + payload;
  }

  // The Smart App Banner: Open passes the full join link to the app.
  function bannerContent(appStoreId, joinUrl) {
    return 'app-id=' + appStoreId + ', app-argument=' + joinUrl;
  }

  function tunnelText(invite) {
    if (!invite || !invite.tunnel) return '';
    return 'Connect to ' + invite.server + "'s " + (invite.tunnel === 'tailscale' ? 'Tailscale' : 'VPN') + ' first, then tap Join in Zoggyfin.';
  }

  var api = {
    readInvite: readInvite,
    detectPlatform: detectPlatform,
    primaryAction: primaryAction,
    openUrl: openUrl,
    bannerContent: bannerContent,
    tunnelText: tunnelText,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZoggyfinJoin = api;
})(this);

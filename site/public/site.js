// Shared behaviour for every page: theme toggle, header border, scroll reveal and store links.
(function () {
  'use strict';
  var root = document.documentElement;
  var config = window.ZOGGYFIN_CONFIG || {};

  // Theme toggle: switch to the opposite of what shows now, and remember it.
  var dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function current() {
    var set = root.getAttribute('data-theme');
    if (set) return set;
    return dark && dark.matches ? 'dark' : 'light';
  }
  function label(btn) {
    btn.setAttribute('aria-label', current() === 'dark' ? 'Use light appearance' : 'Use dark appearance');
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
    label(btn);
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('zf-theme', next); } catch (e) {}
      label(btn);
    });
  });

  // Header: show the hairline only after the page scrolls.
  var nav = document.querySelector('.nav');
  if (nav) {
    var onScroll = function () { nav.classList.toggle('scrolled', window.scrollY > 8); };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Reveal sections as they come into view. Without IntersectionObserver, show all.
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    Array.prototype.forEach.call(items, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(items, function (el) { el.classList.add('in'); });
  }

  // Store links. The HTML has working defaults (TestFlight, /download); config.js can change them.
  if (config.appStoreUrl) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-store="ios"]'), function (a) {
      a.href = config.appStoreUrl;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-when="testflight"]'), function (el) { el.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-when="appstore"]'), function (el) { el.hidden = false; });
  }
  if (config.androidUrl) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-store="android"]'), function (a) {
      a.href = config.androidUrl;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-when="android-soon"]'), function (el) { el.hidden = true; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-when="android-ready"]'), function (el) { el.hidden = false; });
  }
  if (config.macUrl) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-store="mac-dmg"]'), function (a) { a.href = config.macUrl; });
  }
})();

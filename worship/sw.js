/* OnStage Worship — offline support. Caches the app so it runs without internet
   (the AI microphone feature still needs internet for the browser's speech service). */
var CACHE = "onstage-worship-v4";
var FILES = [
  "./", "./index.html", "./output.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png",
  "./css/app.css", "./css/render.css", "./css/fonts.css",
  "./js/books.js", "./js/songformats.js", "./data/hymns.js", "./js/speechref.js", "./js/bible.js", "./js/render.js", "./js/store.js", "./js/listener.js", "./js/app.js",
  "./data/kjv.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

/* Network first (so updates arrive), falling back to the cache when offline. */
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function (res) {
      if (res.ok && new URL(e.request.url).origin === location.origin) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(e.request, { ignoreSearch: true }).then(function (r) { return r || caches.match("./index.html"); });
    })
  );
});

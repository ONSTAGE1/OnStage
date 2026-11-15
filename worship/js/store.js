/*
 * OnStage Worship — persistence.
 * Small JSON data (songs, themes, schedule, settings) → localStorage.
 * Media files and imported Bibles → IndexedDB (they can be large).
 */
(function (root) {
  var PREFIX = "onstage.worship.";

  function get(key, fallback) {
    try {
      var v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch (e) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { console.warn("Could not save", key, e); return false; }
  }

  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve, reject) {
      if (!root.indexedDB) return reject(new Error("IndexedDB unavailable"));
      var req = indexedDB.open("onstage-worship", 1);
      req.onupgradeneeded = function () {
        var d = req.result;
        if (!d.objectStoreNames.contains("media")) d.createObjectStore("media", { keyPath: "id" });
        if (!d.objectStoreNames.contains("bibles")) d.createObjectStore("bibles", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var t = d.transaction(store, mode);
        var s = t.objectStore(store);
        var out = fn(s);
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }
  function all(store) { return tx(store, "readonly", function (s) { return s.getAll(); }); }
  function put(store, obj) { return tx(store, "readwrite", function (s) { s.put(obj); }); }
  function del(store, id) { return tx(store, "readwrite", function (s) { s.delete(id); }); }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  root.OnStageStore = { get: get, set: set, all: all, put: put, del: del, uid: uid };
})(this);

/*
 * OnStage Worship — shared slide renderer used by the projector output,
 * the stage display and the Preview/Live monitors in the console.
 * Renders into a fixed 1920x1080 "stage" that is scaled to fit.
 */
(function (root) {
  var W = 1920, H = 1080;

  var DEFAULT_THEME = {
    font: "DM Sans", size: 80, color: "#ffffff", bold: true, italic: false, uppercase: false,
    shadow: true, outline: false, align: "center", valign: "middle", lineHeight: 1.25, padding: 110,
    refSize: 46, refColor: "#d5ff54", refPosition: "bottom", dim: 0.35, bg: "grad:0"
  };

  var GRADIENTS = [
    "radial-gradient(circle at 30% 20%, #2b3a67 0%, #10131f 55%, #07080c 100%)",
    "linear-gradient(135deg, #1d2b2a 0%, #0c1414 60%, #050707 100%)",
    "linear-gradient(160deg, #3a1c4a 0%, #1a0f2a 55%, #080510 100%)",
    "radial-gradient(circle at 70% 80%, #5b3a1a 0%, #24160b 50%, #0a0603 100%)",
    "linear-gradient(180deg, #0f2b45 0%, #0a1726 60%, #03070c 100%)",
    "radial-gradient(circle at 50% 120%, #c0623b 0%, #5b2238 35%, #150a1d 75%)",
    "linear-gradient(135deg, #24321a 0%, #121a0d 60%, #050803 100%)",
    "#000000"
  ];

  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }

  /* Create the stage structure inside `host`. Returns a renderer object. */
  function createStage(host, opts) {
    opts = opts || {};
    host.classList.add("os-host");
    var stage = el("div", "os-stage", host);
    stage.style.width = W + "px"; stage.style.height = H + "px";
    var bg = el("div", "os-bg", stage);
    var dim = el("div", "os-dim", stage);
    var content = el("div", "os-content", stage);
    var logo = el("div", "os-logo", stage);
    var black = el("div", "os-black", stage);
    var alertBar = el("div", "os-alert", stage);
    var alertText = el("span", "", alertBar);

    var r = { host: host, stage: stage, bgKey: null, video: null, muted: !!opts.muted, last: null, timer: null };

    function scale() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      var s = Math.min(w / W, h / H);
      stage.style.transform = "translate(" + ((w - W * s) / 2) + "px," + ((h - H * s) / 2) + "px) scale(" + s + ")";
    }
    r.scale = scale;
    if (root.ResizeObserver) new ResizeObserver(scale).observe(host);
    else root.addEventListener("resize", scale);
    scale();

    r.render = function (state) {
      state = state || {};
      var slide = state.slide || null;
      var theme = Object.assign({}, DEFAULT_THEME, (slide && slide.theme) || {});
      setBackground(r, bg, slide ? (slide.bgResolved || resolveBg(theme.bg)) : resolveBg(state.defaultBg || "color:#000"), state);
      dim.style.opacity = slide && slide.type !== "media" ? theme.dim : 0;

      var key = slide ? JSON.stringify([slide.text, slide.ref, slide.type, slide.countdown, theme]) : "";
      if (key !== r.last) {
        r.last = key;
        renderContent(content, slide, theme);
      }
      content.style.opacity = state.clear ? 0 : 1;
      black.style.opacity = state.black ? 1 : 0;
      if (state.logoUrl) logo.style.backgroundImage = "url(" + JSON.stringify(state.logoUrl) + ")";
      logo.style.opacity = state.logo ? 1 : 0;

      var a = state.alert || {};
      if (a.on && a.text) {
        if (alertText.textContent !== a.text) {
          alertText.textContent = a.text;
          alertText.style.animation = "none"; void alertText.offsetWidth; alertText.style.animation = "";
        }
        alertBar.classList.add("on");
      } else alertBar.classList.remove("on");

      if (r.video && state.videoCmd && state.videoCmd.id !== r.videoCmdId) {
        r.videoCmdId = state.videoCmd.id;
        var c = state.videoCmd.action;
        if (c === "play") r.video.play().catch(function () {});
        else if (c === "pause") r.video.pause();
        else if (c === "restart") { r.video.currentTime = 0; r.video.play().catch(function () {}); }
      }
    };
    return r;
  }

  function resolveBg(bg) {
    if (!bg) return { css: "#000" };
    if (typeof bg === "object") return bg;
    if (bg.indexOf("grad:") === 0) return { css: GRADIENTS[+bg.slice(5)] || GRADIENTS[0] };
    if (bg.indexOf("color:") === 0) return { css: bg.slice(6) };
    return { css: "#000" };
  }

  function setBackground(r, bgEl, bg, state) {
    var key = bg.url ? bg.kind + ":" + bg.url : "css:" + bg.css;
    if (key === r.bgKey) return;
    r.bgKey = key;
    var old = bgEl.firstChild;
    var layer = document.createElement(bg.kind === "video" ? "video" : "div");
    layer.className = "os-bg-layer";
    if (bg.kind === "video") {
      layer.src = bg.url; layer.autoplay = true; layer.playsInline = true;
      layer.loop = bg.loop !== false; layer.muted = r.muted || !!bg.muted;
      layer.play && layer.play().catch(function () { layer.muted = true; layer.play().catch(function () {}); });
      r.video = layer;
    } else {
      r.video = null;
      if (bg.kind === "image") layer.style.background = "#000 url(" + JSON.stringify(bg.url) + ") center/" + (bg.fit || "cover") + " no-repeat";
      else layer.style.background = bg.css;
    }
    layer.style.opacity = 0;
    bgEl.appendChild(layer);
    requestAnimationFrame(function () { requestAnimationFrame(function () { layer.style.opacity = 1; }); });
    setTimeout(function () {
      while (bgEl.firstChild && bgEl.firstChild !== layer) {
        var o = bgEl.firstChild;
        if (o.tagName === "VIDEO") { o.pause(); o.removeAttribute("src"); o.load(); }
        bgEl.removeChild(o);
      }
    }, 600);
  }

  function renderContent(content, slide, theme) {
    if (content._timer) { clearInterval(content._timer); content._timer = null; }
    var next = document.createElement("div");
    next.className = "os-frame";
    next.style.padding = theme.padding + "px";
    next.style.justifyContent = { top: "flex-start", middle: "center", bottom: "flex-end" }[theme.valign] || "center";
    next.style.textAlign = theme.align;

    if (slide && slide.type !== "media") {
      var body = el("div", "os-text", next);
      body.style.fontFamily = JSON.stringify(theme.font) + ", 'DM Sans', sans-serif";
      body.style.color = theme.color;
      body.style.fontWeight = theme.bold ? 700 : 400;
      body.style.fontStyle = theme.italic ? "italic" : "normal";
      body.style.textTransform = theme.uppercase ? "uppercase" : "none";
      body.style.lineHeight = theme.lineHeight;
      var sh = [];
      if (theme.shadow) sh.push("0 4px 18px rgba(0,0,0,.75)", "0 2px 4px rgba(0,0,0,.6)");
      body.style.textShadow = sh.join(",");
      if (theme.outline) body.style.webkitTextStroke = "2px rgba(0,0,0,.85)";

      if (slide.type === "countdown" && slide.countdown) {
        body.classList.add("os-count");
        var lbl = slide.countdown.label || "";
        var tick = function () {
          var ms = Math.max(0, slide.countdown.target - Date.now());
          var m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
          body.innerHTML = (lbl ? '<div class="os-count-label">' + esc(lbl) + "</div>" : "") +
            '<div class="os-count-time">' + m + ":" + (s < 10 ? "0" : "") + s + "</div>";
        };
        tick(); content._timer = setInterval(tick, 250);
      } else {
        var html = esc(slide.text || "").replace(/\n/g, "<br>");
        if (slide.verseNums) html = html.replace(/\[(\d+)\]/g, '<sup class="os-vn">$1</sup>');
        body.innerHTML = html;
      }

      if (slide.ref) {
        var ref = el("div", "os-ref", next);
        ref.textContent = slide.ref;
        ref.style.fontSize = theme.refSize + "px";
        ref.style.color = theme.refColor;
        ref.style.fontFamily = body.style.fontFamily;
        ref.style.textShadow = body.style.textShadow;
        if (theme.refPosition === "top") next.insertBefore(ref, body);
      }
    }

    var prev = content.querySelectorAll(".os-frame");
    content.appendChild(next);
    if (slide && slide.type !== "media" && !(slide.type === "countdown")) fit(next.querySelector(".os-text"), theme.size, 24, next);
    else if (slide && slide.type === "countdown") next.querySelector(".os-text").style.fontSize = Math.round(theme.size * 1.6) + "px";
    requestAnimationFrame(function () { next.classList.add("in"); });
    prev.forEach(function (p) {
      p.classList.remove("in"); p.classList.add("out");
      setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 450);
    });
  }

  /* Shrink font until the text fits within its frame. */
  function fit(textEl, max, min, frame) {
    if (!textEl) return;
    var avail = H - 0; // frame is full height
    var lo = min, hi = max, best = min;
    var refEl = frame.querySelector(".os-ref");
    function fits(px) {
      textEl.style.fontSize = px + "px";
      return frame.scrollHeight <= avail + 1 && textEl.scrollWidth <= textEl.clientWidth + 1;
    }
    if (fits(max)) return;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (fits(mid)) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    textEl.style.fontSize = best + "px";
    void refEl;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  root.OnStageRender = { createStage: createStage, resolveBg: resolveBg, GRADIENTS: GRADIENTS, DEFAULT_THEME: DEFAULT_THEME, esc: esc };
})(this);

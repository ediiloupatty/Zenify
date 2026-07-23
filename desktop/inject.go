package main

// titlebarJS is injected into every page (before its own scripts, on each
// navigation). It marks the desktop environment, forwards now-playing events to
// Discord, and builds a custom 32px title bar with working window controls that
// call the win* functions bound in main.go. All styling is inline so it works on
// the unmodified online web app.
const titlebarJS = `
window.__ZENIFY_DESKTOP__ = true;

// Latest now-playing snapshot, kept so the mini player can paint itself the
// moment it opens instead of waiting for the next track change.
window.__zenifyNP = null;

window.addEventListener('zenify:nowplaying', function (e) {
  window.__zenifyNP = e.detail;
  try { window.zenifyPresence(e.detail); } catch (_) {}
  try { window.__zenifyRenderMini(); } catch (_) {}
});

// Single transport path for every control outside the page: hardware media keys,
// the tray menu, and the mini player all end up here, clicking the player's own
// buttons. Nothing re-implements playback, so nothing can drift out of sync.
window.__zenifyClick = function (action) {
  var map = {
    'play-pause': '[aria-label="Play"],[aria-label="Pause"]',
    'next':       '[aria-label="Next track"]',
    'prev':       '[aria-label="Previous track"]',
    'stop':       '[aria-label="Pause"]'
  };
  var sel = map[action];
  if (!sel) return;
  var btns = document.querySelectorAll(sel);
  for (var i = 0; i < btns.length; i++) {
    if (btns[i].offsetParent !== null) { btns[i].click(); return; }
  }
  // Fallback: click the first match even if the visibility check failed.
  if (btns.length) btns[0].click();
};

// Reveal the (off-screen) window as soon as the document has painted its first
// frame (the dark shell / loading skeleton) — NOT on 'load'. With streaming SSR
// and a slow backend, 'load' only fires once all data has arrived, which would
// keep the window hidden the whole time (skeleton never seen) and then flash.
// The root element paints dark from the first frame (inline bg on <html>), so
// revealing early shows the skeleton with no white flash.
(function revealOnReady() {
  var done = false;
  function reveal() {
    if (done) return; done = true;
    try { window.winReveal(); } catch (_) {}
  }
  function tick() {
    if (done) return;
    if (document.body && document.body.childNodes.length > 0) {
      // One extra rAF so the first paint (incl. CSS) has actually landed.
      requestAnimationFrame(function () { requestAnimationFrame(reveal); });
    } else {
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(tick);
  // Hard fallback so the window can never get stuck off-screen.
  setTimeout(reveal, 3000);
})();

(function () {
  function call(n){ var f = window[n]; if (typeof f === 'function') f(); }

  function mkbtn(svg, hover, fn){
    var b = document.createElement('button');
    b.style.cssText = 'height:100%;width:46px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;color:inherit;cursor:default;transition:background .15s,color .15s;-webkit-app-region:no-drag';
    b.innerHTML = svg;
    b.onmousedown = function(e){ e.stopPropagation(); };
    b.onmouseenter = function(){ b.style.background = hover; if (hover === '#dc2626') b.style.color = '#fff'; };
    b.onmouseleave = function(){ b.style.background = 'transparent'; b.style.color = 'inherit'; };
    b.onclick = fn;
    return b;
  }

  function inject(){
    if (!document.body || document.getElementById('zenify-titlebar')) return;

    // Replace WebView2's default offline / error page with a premium dark mode Zenify screen
    if (location.href.indexOf('chromewebdata') !== -1 || document.body.innerHTML.indexOf('ERR_INTERNET_DISCONNECTED') !== -1 || document.body.innerHTML.indexOf('ERR_CONNECTION_REFUSED') !== -1) {
      document.body.innerHTML = '';
      document.body.style.background = '#0a0c11';
      var errBox = document.createElement('div');
      errBox.style.cssText = 'position:fixed;top:32px;left:0;right:0;bottom:0;background:#0a0c11;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;z-index:2147483640;padding:20px;text-align:center;user-select:none';
      errBox.innerHTML = '<div style="position:absolute;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle, rgba(20,184,166,0.12) 0%, transparent 70%);top:50%;left:50%;transform:translate(-50%, -50%);pointer-events:none;"></div>' +
        '<div style="width:68px;height:68px;border-radius:22px;background:rgba(20,184,166,0.08);border:1px solid rgba(20,184,166,0.18);display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 12px 32px rgba(0,0,0,0.4);">' +
        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div>' +
        '<h1 style="font-size:22px;font-weight:700;letter-spacing:-0.03em;margin:0 0 8px 0;color:#f8fafc;">Unable to Connect to Zenify</h1>' +
        '<p style="font-size:14px;color:#94a3b8;max-width:360px;margin:0 0 30px 0;line-height:1.6;">Please check your network connection or verify that the Zenify server is running. Playback and library access will resume once the connection is restored.</p>' +
        '<button onclick="location.reload()" style="background:#14b8a6;color:#042f2e;border:0;padding:11px 26px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(20,184,166,0.25);transition:all 0.2s;">Try Again</button>' +
        '<div style="margin-top:36px;font-size:11px;font-family:monospace;color:#64748b;letter-spacing:0.05em;background:rgba(255,255,255,0.03);padding:5px 12px;border-radius:6px;border:1px solid rgba(255,255,255,0.05);">ERR_INTERNET_DISCONNECTED</div>';
      document.body.appendChild(errBox);
    }

    var style = document.createElement('style');
    style.id = 'zenify-titlebar-style';
    // Reserve the 32px for the title bar on normal (in-flow) pages, but NOT on
    // full-screen fixed overlays (e.g. the expanded player) — those must stay a
    // full 100vh so nothing leaks at the bottom; the title bar simply floats over
    // their top via its higher z-index.
    style.textContent = 'body{padding-top:32px !important}.h-screen:not(.fixed){height:calc(100vh - 32px) !important}' +
      // Mini player: the page keeps running (and playing) underneath — it is just
      // covered. Nothing is unmounted, so audio never even hiccups.
      'html.zenify-mini body{padding-top:0 !important;overflow:hidden !important}' +
      'html.zenify-mini #zenify-titlebar{display:none !important}' +
      'html.zenify-mini #zenify-mini{display:flex !important}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'zenify-titlebar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:32px;z-index:2147483647;display:flex;align-items:center;justify-content:space-between;background:#0a0c11;border-bottom:1px solid rgba(255,255,255,.08);color:#9aa3af;user-select:none;font-family:system-ui,Segoe UI,sans-serif';
    bar.onmousedown = function(){ call('winDragStart'); };
    bar.ondblclick = function(){ call('winToggleMaximize'); };

    // Left: back / forward nav
    var navBtn = 'height:28px;width:28px;display:flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:6px;color:#9aa3af;cursor:default;transition:background .15s,color .15s;-webkit-app-region:no-drag;padding:0';
    var back = document.createElement('button');
    back.style.cssText = navBtn;
    back.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="10 4 6 8 10 12"/></svg>';
    back.onmousedown = function(e){ e.stopPropagation(); };
    back.onmouseenter = function(){ back.style.background='rgba(255,255,255,.08)'; back.style.color='#fff'; };
    back.onmouseleave = function(){ back.style.background='transparent'; back.style.color='#9aa3af'; };
    back.onclick = function(){ window.history.back(); };

    var fwd = document.createElement('button');
    fwd.style.cssText = navBtn;
    fwd.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 4 10 8 6 12"/></svg>';
    fwd.onmousedown = function(e){ e.stopPropagation(); };
    fwd.onmouseenter = function(){ fwd.style.background='rgba(255,255,255,.08)'; fwd.style.color='#fff'; };
    fwd.onmouseleave = function(){ fwd.style.background='transparent'; fwd.style.color='#9aa3af'; };
    fwd.onclick = function(){ window.history.forward(); };

    var leftZone = document.createElement('div');
    leftZone.style.cssText = 'display:flex;align-items:center;gap:2px;padding:0 8px;height:100%;min-width:100px';
    leftZone.appendChild(back);
    leftZone.appendChild(fwd);
    bar.appendChild(leftZone);

    // Center: logo + app name + current page
    var center = document.createElement('div');
    center.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;pointer-events:auto;-webkit-app-region:no-drag;cursor:default';
    center.onmousedown = function(e){ e.stopPropagation(); };
    center.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="#14b8a6">' +
      '<rect x="2.5" y="8" width="2.6" height="8" rx="1.3"/>' +
      '<rect x="6.6" y="5.5" width="2.6" height="13" rx="1.3"/>' +
      '<rect x="10.7" y="3.5" width="2.6" height="17" rx="1.3"/>' +
      '<rect x="14.8" y="6.5" width="2.6" height="11" rx="1.3"/>' +
      '<rect x="18.9" y="8.5" width="2.6" height="7" rx="1.3"/></svg>' +
      '<span style="font-size:12px;font-weight:600;letter-spacing:.04em;color:#e2e8f0">Zenify</span>' +
      '<span id="zenify-page-label" style="font-size:11px;font-weight:500;color:#64748b"></span>';
    bar.appendChild(center);

    var ctr = document.createElement('div');
    ctr.style.cssText = 'display:flex;align-items:center;height:100%';

    var miniSvg = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.2" y="1.2" width="8.6" height="8.6" rx="1"/><rect x="4.6" y="5.6" width="5" height="4.2" rx="1" fill="currentColor" stroke="none"/></svg>';
    var minSvg = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="1" y1="6" x2="10" y2="6"/></svg>';
    var maxSvg = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="1.2" y="1.2" width="8.6" height="8.6" rx="1"/></svg>';
    var clsSvg = '<svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.2"><line x1="1.5" y1="1.5" x2="9.5" y2="9.5"/><line x1="9.5" y1="1.5" x2="1.5" y2="9.5"/></svg>';

    ctr.appendChild(mkbtn(miniSvg, 'rgba(255,255,255,.1)', function(){ call('winToggleMini'); }));
    ctr.appendChild(mkbtn(minSvg, 'rgba(255,255,255,.1)', function(){ call('winMinimize'); }));
    ctr.appendChild(mkbtn(maxSvg, 'rgba(255,255,255,.1)', function(){ call('winToggleMaximize'); }));
    ctr.appendChild(mkbtn(clsSvg, '#dc2626', function(){ call('winClose'); }));

    bar.appendChild(ctr);
    document.body.appendChild(bar);

    injectMini();

    // A reload while mini (e.g. a client-side navigation) drops the html class,
    // but Go still has the window shrunk — ask it and re-apply.
    try {
      window.winIsMini().then(function (m) { if (m) window.__zenifyApplyMini(true); });
    } catch (_) {}
  }

  // ── Mini player ───────────────────────────────────────────────────────────
  // A fixed overlay rather than a second window: webview_go owns exactly one
  // window, and covering the page means playback (and all its state) is never
  // torn down. Go shrinks the window to match; this draws what goes inside it.
  function injectMini(){
    if (!document.body || document.getElementById('zenify-mini')) return;

    // Frosted dark glass. The window itself is set semi-transparent by the Go
    // side (LWA_ALPHA) so a game behind shows through; this panel is the tinted,
    // blurred glass over it. Cover/text/buttons stay high-contrast so they read
    // as solid even while the whole overlay is see-through.
    var m = document.createElement('div');
    m.id = 'zenify-mini';
    // Frosted dark glass: a semi-opaque slate tint + blur so the panel reads as
    // one tidy card at idle instead of loose text floating over the desktop. The
    // whole window is still faded by the Go side (LWA_ALPHA), so this "solid"
    // glass is see-through overall — transparent, but clearly there.
    m.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483646;display:none;align-items:center;gap:14px;padding:14px 16px;box-sizing:border-box;' +
      'background:linear-gradient(135deg,rgba(15,23,42,.80),rgba(2,6,23,.86));' +
      'backdrop-filter:blur(16px) saturate(1.25);-webkit-backdrop-filter:blur(16px) saturate(1.25);' +
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 0 0 1px rgba(255,255,255,.05);' +
      'color:#e2e8f0;font-family:system-ui,Segoe UI,sans-serif;user-select:none';
    m.onmousedown = function(){ call('winDragStart'); };
    // Hover → fully opaque (crisp to read & click); leave → back to see-through.
    m.onmouseenter = function(){ try { window.winMiniHover(true); } catch (_) {} };
    m.onmouseleave = function(){ try { window.winMiniHover(false); } catch (_) {} };

    var cover = document.createElement('div');
    cover.id = 'zenify-mini-cover';
    cover.style.cssText = 'width:78px;height:78px;border-radius:12px;flex-shrink:0;background:linear-gradient(135deg,#134e4a,#1e293b);background-size:cover;background-position:center;box-shadow:0 8px 22px rgba(0,0,0,.55),inset 0 0 0 1px rgba(255,255,255,.10)';

    var col = document.createElement('div');
    // padding-right keeps the title/artist clear of the absolute window controls
    // pinned to the top-right corner.
    col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:2px;padding-right:58px';

    var title = document.createElement('div');
    title.id = 'zenify-mini-title';
    // A single soft shadow keeps white text legible when a bright game shows
    // through the idle (faded) panel, without muddying it over the dark card.
    title.style.cssText = 'font-size:14px;font-weight:800;letter-spacing:-.01em;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,.85)';
    title.textContent = 'Zenify';

    var artist = document.createElement('div');
    artist.id = 'zenify-mini-artist';
    artist.style.cssText = 'font-size:12px;font-weight:600;color:#dbe3ec;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-shadow:0 1px 3px rgba(0,0,0,.8)';

    var ctrls = document.createElement('div');
    ctrls.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:7px';

    function tbtn(svg, fn, big){
      var b = document.createElement('button');
      var size = big ? 32 : 28;
      b.style.cssText = 'width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;border:0;border-radius:50%;cursor:default;color:' + (big ? '#042f2e' : '#e2e8f0') + ';background:' + (big ? '#14b8a6' : 'rgba(255,255,255,.08)') + ';transition:background .15s,color .15s,transform .1s;padding:0;' + (big ? 'box-shadow:0 4px 14px rgba(20,184,166,.45)' : '');
      b.innerHTML = svg;
      b.onmousedown = function(e){ e.stopPropagation(); };
      b.onmouseenter = function(){ if (big) { b.style.background = '#2dd4bf'; } else { b.style.background = 'rgba(255,255,255,.18)'; b.style.color = '#fff'; } };
      b.onmouseleave = function(){ if (big) { b.style.background = '#14b8a6'; } else { b.style.background = 'rgba(255,255,255,.08)'; b.style.color = '#e2e8f0'; } };
      b.onclick = function(e){ e.stopPropagation(); fn(); };
      return b;
    }

    var prevSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>';
    var nextSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>';

    var play = tbtn('', function(){ window.__zenifyClick('play-pause'); }, true);
    play.id = 'zenify-mini-play';

    ctrls.appendChild(tbtn(prevSvg, function(){ window.__zenifyClick('prev'); }));
    ctrls.appendChild(play);
    ctrls.appendChild(tbtn(nextSvg, function(){ window.__zenifyClick('next'); }));

    col.appendChild(title);
    col.appendChild(artist);
    col.appendChild(ctrls);

    // Top-right window controls: minimize (to taskbar) + expand (back to full).
    function cbtn(svg, tip, fn){
      var b = document.createElement('button');
      b.style.cssText = 'width:24px;height:24px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.06);border:0;border-radius:7px;color:#94a3b8;cursor:default;padding:0;transition:background .15s,color .15s';
      b.title = tip;
      b.innerHTML = svg;
      b.onmousedown = function(e){ e.stopPropagation(); };
      b.onmouseenter = function(){ b.style.background = 'rgba(255,255,255,.16)'; b.style.color = '#fff'; };
      b.onmouseleave = function(){ b.style.background = 'rgba(255,255,255,.06)'; b.style.color = '#94a3b8'; };
      b.onclick = function(e){ e.stopPropagation(); fn(); };
      return b;
    }
    var minimizeSvg = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><line x1="2.5" y1="6" x2="9.5" y2="6"/></svg>';
    var expandSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';

    var winctrls = document.createElement('div');
    winctrls.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;align-items:center;gap:5px';
    winctrls.appendChild(cbtn(minimizeSvg, 'Minimize', function(){ call('winMinimize'); }));
    winctrls.appendChild(cbtn(expandSvg, 'Kembali ke jendela penuh', function(){ call('winToggleMini'); }));

    // Thin progress bar pinned edge-to-edge along the bottom, like a real
    // mini-player. Driven by a low-frequency ticker (below) reading the live
    // position the web app publishes on window.__zenifyProgress.
    var track = document.createElement('div');
    track.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:3px;background:rgba(255,255,255,.10)';
    var fill = document.createElement('div');
    fill.id = 'zenify-mini-progress';
    fill.style.cssText = 'height:100%;width:0;background:linear-gradient(90deg,#14b8a6,#2dd4bf);box-shadow:0 0 6px rgba(20,184,166,.5);transition:width .25s linear';
    track.appendChild(fill);

    m.appendChild(cover);
    m.appendChild(col);
    m.appendChild(winctrls);
    m.appendChild(track);
    document.body.appendChild(m);

    window.__zenifyRenderMini();
  }

  // Progress ticker: only runs while the mini overlay is open. A 250ms interval
  // (not rAF) is plenty for a progress bar and keeps the desktop app idle-quiet;
  // the CSS width transition smooths the steps into continuous motion.
  var miniProgressTimer = 0;
  function paintMiniProgress(){
    var fill = document.getElementById('zenify-mini-progress');
    if (!fill) return;
    var p = window.__zenifyProgress;
    var pct = (p && p.duration > 0) ? Math.max(0, Math.min(1, p.position / p.duration)) * 100 : 0;
    fill.style.width = pct + '%';
  }
  function startMiniProgress(){
    if (miniProgressTimer) return;
    paintMiniProgress();
    miniProgressTimer = setInterval(paintMiniProgress, 250);
  }
  function stopMiniProgress(){
    if (!miniProgressTimer) return;
    clearInterval(miniProgressTimer);
    miniProgressTimer = 0;
  }

  var PLAY_SVG  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  var PAUSE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';

  window.__zenifyRenderMini = function(){
    var np = window.__zenifyNP;
    var t = document.getElementById('zenify-mini-title');
    var a = document.getElementById('zenify-mini-artist');
    var c = document.getElementById('zenify-mini-cover');
    var p = document.getElementById('zenify-mini-play');
    if (!t || !a || !c || !p) return;

    t.textContent = (np && np.title) ? np.title : 'Tidak ada lagu';
    a.textContent = (np && np.artist) ? np.artist : '';
    c.style.backgroundImage = (np && np.cover) ? 'url("' + np.cover + '")' : '';
    p.innerHTML = (np && np.state === 'playing') ? PAUSE_SVG : PLAY_SVG;
  };

  window.__zenifyApplyMini = function(mini){
    document.documentElement.classList.toggle('zenify-mini', !!mini);
    if (mini) { injectMini(); window.__zenifyRenderMini(); startMiniProgress(); }
    else { stopMiniProgress(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
  // Safety net in case a client-side route change wipes the node.
  setInterval(inject, 1000);

  // Update the page label in the titlebar whenever the route changes.
  function getPageName(){
    var p = location.pathname;
    if (p === '/') return 'Home';
    if (p === '/favorites') return 'Favorites';
    if (p === '/settings') return 'Settings';
    if (p === '/profile') return 'Profile';
    if (p === '/songs') return 'Songs';
    if (p === '/albums') return 'Albums';
    if (p === '/artists') return 'Artists';
    if (p === '/playlists') return 'Playlists';
    if (p === '/admin') return 'Admin';
    if (p.indexOf('/album/') === 0) return 'Album';
    if (p.indexOf('/artist/') === 0) return 'Artist';
    if (p === '/login') return 'Login';
    if (p === '/signup') return 'Sign Up';
    var seg = p.split('/')[1];
    return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : '';
  }
  var lastPagePath = '';
  function updatePage(){
    if (location.pathname === lastPagePath) return;
    lastPagePath = location.pathname;
    var el = document.getElementById('zenify-page-label');
    if (el) {
      var name = getPageName();
      el.textContent = name ? '\u2014 ' + name : '';
    }
  }
  setInterval(updatePage, 300);
  updatePage();
})();

// Hardware media keys (Play/Pause, Next, Prev, Stop). The Go side captures
// WM_APPCOMMAND and dispatches 'zenify:mediakey' with detail = action name.
window.addEventListener('zenify:mediakey', function (e) {
  window.__zenifyClick(e.detail);
});

// ── Native feel ─────────────────────────────────────────────────────────────
// WebView2 is Chromium, so the page shows up wearing browser affordances that no
// native app has: a "Reload / Save image as" context menu, blue text selection
// across every label, ghost images when you drag a cover, rubber-band overscroll,
// and fat default scrollbars. Stripping them is what actually makes the window
// stop feeling like a web page — the UI being HTML is not what gives it away.
//
// Deliberately only in the desktop shell: the site in a real browser should keep
// behaving like a site.
(function nativeFeel(){
  var css = document.createElement('style');
  css.id = 'zenify-native-feel';
  css.textContent =
    // Text selection is for text fields, not for chrome.
    '*{-webkit-user-select:none;user-select:none}' +
    'input,textarea,[contenteditable="true"]{-webkit-user-select:text !important;user-select:text !important}' +
    // No drag ghosts off covers and links.
    'img,a{-webkit-user-drag:none;user-drag:none}' +
    // No rubber-band / pull-to-refresh at the edges.
    'html,body{overscroll-behavior:none !important}' +
    // Slim, dark, app-style scrollbars.
    '::-webkit-scrollbar{width:10px;height:10px}' +
    '::-webkit-scrollbar-track{background:transparent}' +
    '::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:6px;' +
      'border:2px solid transparent;background-clip:content-box}' +
    '::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.28);' +
      'border:2px solid transparent;background-clip:content-box}' +
    '::-webkit-scrollbar-corner{background:transparent}';
  (document.head || document.documentElement).appendChild(css);

  // Suppress the browser context menu everywhere except text fields, where
  // cut/copy/paste is something native apps offer too.
  document.addEventListener('contextmenu', function(e){
    var t = e.target;
    if (!t || !(t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
      e.preventDefault();
    }
  }, true);

  document.addEventListener('dragstart', function(e){
    var t = e.target;
    if (t && (t.tagName === 'IMG' || t.tagName === 'A')) e.preventDefault();
  }, true);

  // Browser-only shortcuts that have no meaning in an app window. Reload
  // (F5 / Ctrl+R) is deliberately left alone — Discord and Slack keep it too, and
  // it is the one escape hatch when a page wedges.
  document.addEventListener('keydown', function(e){
    if (!e.ctrlKey) return;
    var k = (e.key || '').toLowerCase();
    if (k === 'p' || k === 's' || k === 'u' || k === 'f' || k === 'g') e.preventDefault();
  }, true);
})();
`

/* 抽號器看片書籤：在 microteaching 看片伺服器（:9002，校內網路／台大 VPN）上開一個自己的圓形視野看片器。
   只能用 4×／10×／40× 三個實際倍率；影像即時向台大伺服器讀取，不複製、不改伺服器上的任何東西。
   按一次書籤之後，抽號器按「看片」就會在同一個分頁直接換片，答案的「視野」點也會跳到那裡。 */
(function () {
  'use strict';
  var me = document.currentScript && document.currentScript.src;
  var APP = me ? new URL(me).origin : 'https://pathology-draw.firebaseapp.com';
  var FIELD = { 4: 5500, 10: 2200, 40: 550 }; /* 視野直徑 µm：10× 目鏡、視野數 22 */
  var OBJS = [4, 10, 40];
  var ORIGIN = location.origin;

  function toast(t, ms) {
    var d = document.getElementById('pdh-toast');
    if (!d) { d = document.createElement('div'); d.id = 'pdh-toast'; d.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:#1d2b36;color:#fff;font:15px/1.5 system-ui,"PingFang TC","Microsoft JhengHei",sans-serif;padding:8px 14px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:90vw'; document.body.appendChild(d); }
    d.textContent = t; d.style.display = 'block';
    clearTimeout(d._t); if (ms !== 0) d._t = setTimeout(function () { d.style.display = 'none'; }, ms || 3500);
  }

  if (window.__pdh) { window.__pdh.again(); return; }
  if (location.protocol === 'https:' && /(^|\.)microteaching\.ntu\.edu\.tw$/.test(location.hostname)) {
    toast('這裡是 microteaching 的目錄頁。請回到抽號器按「看片」，在新開的看片分頁再按一次這個書籤。', 9000);
    return;
  }

  var API = window.__PD_API || ORIGIN + '/api/Studies';
  var OSD_SRC = window.__PD_OSD || ORIGIN + '/Scripts/SeaDragon/openseadragon.js';
  var STUDIES = null, V = null, vp = null, sid = '', mpp = 0.2266, obj = 4, D = 400, zt = null, busy = false;
  var panel = null, clients = [], pendingGo = null;

  function idOf(s) { s = String(s || '').trim().toUpperCase().replace(/\s+/g, ''); if (/^\d{1,4}$/.test(s)) s = 'PA' + ('0000' + s).slice(-4); return s.replace(/[^A-Z0-9_]/g, ''); }
  function qp(k) { var m = (location.search + '&' + location.hash.replace(/^#/, '&')).match(new RegExp('[?&]' + k + '=([^&#]+)')); return m ? decodeURIComponent(m[1]) : ''; }
  function wantedFromUrl() { return idOf(qp('pd')); }
  function goFromUrl() { var x = qp('x'), y = qp('y'), o = +qp('o'); return x && y ? { x: +x, y: +y, obj: OBJS.indexOf(o) >= 0 ? o : 40 } : null; }

  function loadStudies() {
    if (STUDIES) return Promise.resolve(STUDIES);
    return fetch(API, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).then(function (a) {
      var m = {};
      (a || []).forEach(function (s) {
        var id = idOf(s.scanID); if (!id || m[id]) return;
        var sm = (s.Sample || [])[0] || {}, fp = (sm.FocalPlane || [])[0] || {};
        m[id] = { guid: s.wlGUID, sno: sm.SNo || 0, fpno: fp.FPNo || 0, lvl: +fp.imgMaxLevel || 10, px: +sm.pixelSpacingX || 0.2266 };
      });
      STUDIES = m; return m;
    });
  }
  function needOSD() {
    if (window.OpenSeadragon) return Promise.resolve();
    return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = OSD_SRC; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  }
  function tileSource(info) {
    if (window.__PD_TILE) return window.__PD_TILE(info);
    return { type: 'openstreetmaps', tilesUrl: ORIGIN + '/FilePath/Pathology/' + info.guid + '/' + info.sno + '/' + info.fpno + '/' };
  }

  /* ---------- 畫面 ---------- */
  var css = document.createElement('style');
  css.textContent = '#pdh-root{position:fixed;inset:0;z-index:2147483000;background:#000;font:13px/1.3 system-ui,"PingFang TC","Microsoft JhengHei",sans-serif}' +
    '#pdh-v{position:absolute;left:0;top:0;right:0;bottom:52px;background:#000}' +
    '#pdh-mask{position:absolute;left:0;top:0;right:0;bottom:52px;pointer-events:none;overflow:hidden;z-index:2}' +
    '#pdh-hole{position:absolute;border-radius:50%;box-shadow:0 0 0 300vmax #000;outline:2px solid #3a3a3a}' +
    '#pdh-bar{position:absolute;left:0;right:0;bottom:0;height:52px;z-index:3;display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;background:#14181c;color:#fff;padding:6px 8px;box-sizing:border-box}' +
    '#pdh-bar button,#pdh-bar input{font:inherit;border:1px solid #8a97a3;background:#2a333b;color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer}' +
    '#pdh-bar input{width:80px;cursor:text}#pdh-bar button[aria-pressed=true]{background:#e8eef3;color:#111;font-weight:700}#pdh-bar .i{color:#cfd8df;padding:0 4px}';
  document.head.appendChild(css);
  var root = document.createElement('div'); root.id = 'pdh-root';
  root.innerHTML = '<div id="pdh-v"></div><div id="pdh-mask"><div id="pdh-hole"></div></div><div id="pdh-bar">' +
    OBJS.map(function (o) { return '<button type="button" data-o="' + o + '">' + o + '×</button>'; }).join('') +
    '<span class="i" id="pdh-i">載入中…</span><input id="pdh-q" placeholder="片號" autocomplete="off"><button type="button" id="pdh-go">換片</button>' +
    '<button type="button" id="pdh-cap">擷取視野到筆記</button><button type="button" id="pdh-p">答案面板</button><button type="button" id="pdh-x">關閉</button></div>';
  document.body.appendChild(root);
  var prevOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden';
  var vdiv = document.getElementById('pdh-v'), hole = document.getElementById('pdh-hole'), bar = document.getElementById('pdh-bar');

  function layout() {
    var r = vdiv.getBoundingClientRect();
    D = Math.max(160, Math.floor(Math.min(r.width, r.height) * 0.94));
    hole.style.width = hole.style.height = D + 'px'; hole.style.left = (r.width - D) / 2 + 'px'; hole.style.top = (r.height - D) / 2 + 'px';
  }
  function zoomFor(o) { return vp.imageToViewportZoom(mpp / (FIELD[o] / D)); }
  function apply(immediate) {
    if (!vp || !V.world.getItemCount()) return;
    layout(); zt = zoomFor(obj);
    if (vp.maxZoomLevel < zt * 1.3) vp.maxZoomLevel = zt * 1.3;
    if (vp.minZoomLevel > zt / 1.3) vp.minZoomLevel = zt / 1.3;
    busy = true; vp.zoomTo(zt, null, !!immediate); busy = false;
    [].forEach.call(bar.querySelectorAll('[data-o]'), function (b) { b.setAttribute('aria-pressed', String(+b.dataset.o === obj)); });
    var f = FIELD[obj];
    document.getElementById('pdh-i').textContent = sid + '　物鏡 ' + obj + '×（總倍率 ' + obj * 10 + '×）視野 ' + (f >= 1000 ? f / 1000 + ' mm' : f + ' µm');
  }
  function setObj(o) { if (OBJS.indexOf(o) < 0) return; obj = o; apply(false); }
  function step(d) { var i = OBJS.indexOf(obj) + d; if (i >= 0 && i < OBJS.length) setObj(OBJS[i]); }
  function onZoom() { if (busy || zt == null) return; if (Math.abs(vp.getZoom() / zt - 1) > 0.02) { busy = true; vp.zoomTo(zt, null, false); busy = false; } }

  /* 停用其他縮放方式：滾輪、數字鍵、雙指 → 改成換物鏡 */
  var wheelT = 0;
  function onWheel(e) { e.preventDefault(); e.stopImmediatePropagation(); var t = Date.now(); if (t - wheelT < 280) return; wheelT = t; step(e.deltaY < 0 ? 1 : -1); }
  function onKey(e) {
    var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
    if (/^[0-9]$/.test(e.key) || e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'keydown') { if (e.key === '+' || e.key === '=') step(1); else if (e.key === '-' || e.key === '_') step(-1); }
    }
  }
  function onTouch(e) { if (e.touches && e.touches.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); } }
  vdiv.addEventListener('wheel', onWheel, { capture: true, passive: false });
  window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true); window.addEventListener('keypress', onKey, true);
  vdiv.addEventListener('touchstart', onTouch, { capture: true, passive: false });
  function onResize() { setTimeout(function () { apply(true); }, 60); }
  window.addEventListener('resize', onResize);

  var NOZOOM = { scrollToZoom: false, clickToZoom: false, dblClickToZoom: false, pinchToZoom: false, flickEnabled: false };
  /* 台大改過的 OpenSeadragon 用全域 MaxImagePixel 當影像座標的尺度（跟官方看片器一樣，座標才對得上） */
  function setScale(lvl) { window.MaxImagePixel = 256 * Math.pow(2, (lvl || 10) - 1); }
  function makeViewer() {
    if (typeof window.MaxImagePixel !== 'number') setScale(10);
    V = OpenSeadragon({ id: 'pdh-v', prefixUrl: ORIGIN + '/images/dragonIcon/', showNavigationControl: false, wrapHorizontal: false,
      visibilityRatio: 0.05, minZoomLevel: 1e-6, maxZoomLevel: 1e6, defaultZoomLevel: 0, animationTime: 0.6,
      gestureSettingsMouse: NOZOOM, gestureSettingsTouch: NOZOOM, gestureSettingsPen: NOZOOM, gestureSettingsUnknown: NOZOOM });
    vp = V.viewport;
    V.addHandler('zoom', onZoom);
    V.addHandler('animation-finish', function () { clearTimeout(vt); vt = setTimeout(function () { send(state()); }, 150); });
    V.addHandler('open', onOpen);
    V.addHandler('open-failed', function () { toast('開不了 ' + sid + '。請確認有連校內網路或台大 VPN。', 6000); });
    window.Pviewer_pd = V;
  }
  var vt = null;

  /* 開片：找到 tissue 的位置，從 4× 開始 */
  function tissueCenter() {
    try {
      var cv = V.drawer.canvas, g = cv.getContext('2d'), w = cv.width, h = cv.height, d = g.getImageData(0, 0, w, h).data, k = w / vdiv.clientWidth, xs = [], ys = [];
      for (var y = 0; y < h; y += 3) for (var x = 0; x < w; x += 3) { var i = (y * w + x) * 4; if (d[i] - d[i + 1] > 35 && d[i] < 240) { xs.push(x / k); ys.push(y / k); } }
      if (xs.length < 20) return null;
      xs.sort(function (a, b) { return a - b; }); ys.sort(function (a, b) { return a - b; });
      return vp.pointFromPixel(new OpenSeadragon.Point(xs[xs.length >> 1], ys[ys.length >> 1]));
    } catch (e) { return null; }
  }
  function onOpen() {
    var go = pendingGo; pendingGo = null;
    if (go && go.x != null) { goTo(go.x, go.y, go.obj, true); hello(); return; }
    vp.goHome(true);
    var tries = 0;
    (function wait() {
      tries++;
      var it = V.world.getItemAt(0), ready = it && (!it.getFullyLoaded || it.getFullyLoaded());
      if (!ready && tries < 25) return setTimeout(wait, 120);
      var c = tissueCenter();
      obj = go && OBJS.indexOf(go.obj) >= 0 ? go.obj : 4; apply(true);
      if (c) vp.panTo(c, true);
      hello();
    })();
  }
  function openSlide(id, go) {
    id = idOf(id); if (!id) return;
    document.getElementById('pdh-i').textContent = '開 ' + id + '…';
    loadStudies().then(function (m) {
      var info = m[id];
      if (!info) { toast('看片伺服器裡找不到 ' + id + '。', 5000); return; }
      sid = id; mpp = info.px || 0.2266; pendingGo = go || {};
      document.title = id + '｜抽號器看片';
      setScale(info.lvl);
      V.open(tileSource(info));
    }).catch(function () { toast('讀不到片子清單。請確認有連校內網路或台大 VPN。', 7000); });
  }

  function center() { var p = vp.viewportToImageCoordinates(vp.getCenter(true)); return { x: Math.round(p.x), y: Math.round(p.y) }; }
  function state() { var c = center(); return { pd: 1, t: 'view', id: sid, x: c.x, y: c.y, obj: obj, mpp: mpp }; }
  function goTo(x, y, o, immediate) {
    if (OBJS.indexOf(+o) >= 0) obj = +o;
    apply(!!immediate);
    vp.panTo(vp.imageToViewportCoordinates(new OpenSeadragon.Point(+x, +y)), !!immediate);
  }

  function capture() {
    var cv = V.drawer && V.drawer.canvas; if (!cv || !cv.getContext) throw new Error('canvas');
    var r = vdiv.getBoundingClientRect(), k = cv.width / r.width;
    var S = D * k, sx = (r.width - D) / 2 * k, sy = (r.height - D) / 2 * k, O = Math.round(Math.min(S, 1000));
    var c = document.createElement('canvas'); c.width = c.height = O; var g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, O, O);
    g.save(); g.beginPath(); g.arc(O / 2, O / 2, O / 2, 0, Math.PI * 2); g.clip();
    g.drawImage(cv, sx, sy, S, S, 0, 0, O, O); g.restore();
    var f = FIELD[obj], cc = center();
    g.fillStyle = '#fff'; g.font = Math.round(O / 38) + 'px sans-serif';
    g.fillText(sid + '  ' + obj + '×  ⌀' + (f >= 1000 ? f / 1000 + ' mm' : f + ' µm'), O * 0.02, O * 0.97);
    var q = 0.82, data = c.toDataURL('image/jpeg', q);
    while (data.length > 380000 && q > 0.5) { q -= 0.08; data = c.toDataURL('image/jpeg', q); }
    return { pd: 1, t: 'cap', id: sid, data: data, w: O, h: O, x: cc.x, y: cc.y, obj: obj };
  }

  /* ---------- 跟抽號器溝通 ---------- */
  function alive(w) { try { return w && !w.closed; } catch (e) { return false; } }
  function send(o, only) { if (!sid) return; clients = clients.filter(alive); (only ? [only] : clients).forEach(function (w) { try { w.postMessage(o, APP); } catch (e) {} }); }
  function hello(only) { var s = state(); s.t = 'hello'; send(s, only); }
  window.addEventListener('message', function (e) {
    if (e.origin !== APP || !e.data || e.data.pd !== 1) return;
    var m = e.data, src = e.source;
    if (src && clients.indexOf(src) < 0) clients.push(src);
    if (m.t === 'hi') { if (sid) hello(src); }
    else if (m.t === 'want-r') { if (!sid && m.id) openSlide(m.id); }
    else if (m.t === 'open') {
      var go = m.x != null ? { x: m.x, y: m.y, obj: m.obj } : (m.obj ? { obj: m.obj } : null);
      if (idOf(m.id) === sid && go && go.x != null) goTo(go.x, go.y, go.obj); else if (idOf(m.id) === sid) hello(src); else openSlide(m.id, go);
    }
    else if (m.t === 'goto') goTo(m.x, m.y, m.obj);
    else if (m.t === 'obj') setObj(+m.obj);
    else if (m.t === 'cap') { var c; try { c = capture(); c.req = m.req; } catch (err) { c = { pd: 1, t: 'cap', req: m.req, err: '擷取失敗' }; } send(c, src); }
  });
  function openPanel() {
    var w = Math.min(460, screen.availWidth / 3 | 0), h = screen.availHeight - 60;
    var p = window.open(APP + '/?p=' + encodeURIComponent(sid), 'pdpanel', 'popup=yes,width=' + w + ',height=' + h + ',left=' + (screen.availWidth - w - 10) + ',top=10');
    if (!p) { toast('答案面板被瀏覽器擋住了，請允許這個網站開新視窗，再按「答案面板」。', 6000); return; }
    panel = p; if (clients.indexOf(p) < 0) clients.push(p);
    try { p.focus(); } catch (e) {}
  }
  bar.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.o) setObj(+b.dataset.o);
    else if (b.id === 'pdh-go') { var q = document.getElementById('pdh-q'); openSlide(q.value); q.value = ''; }
    else if (b.id === 'pdh-cap') {
      var c; try { c = capture(); } catch (err) { toast('擷取失敗：這個瀏覽器不允許讀取畫面。'); return; }
      var to = alive(panel) ? panel : clients.filter(alive)[0];
      if (!to) { toast('先從抽號器按「看片」或按「答案面板」並登入，擷取的圖才會存到你的筆記。', 5000); return; }
      send(c, to); toast('已送到抽號器，存進「' + sid + '」的筆記。');
    } else if (b.id === 'pdh-p') openPanel();
    else if (b.id === 'pdh-x') off();
  });
  document.getElementById('pdh-q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { openSlide(this.value); this.value = ''; } });
  function off() {
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); window.removeEventListener('keypress', onKey, true);
    window.removeEventListener('resize', onResize);
    try { V.destroy(); } catch (e) {}
    root.remove(); css.remove(); document.documentElement.style.overflow = prevOverflow; window.__pdh = null;
  }
  window.__pdh = { again: function () { if (sid) { apply(true); hello(); } }, goTo: goTo, setObj: setObj, capture: capture, state: state, open: openSlide, viewer: function () { return V; } };

  /* ---------- 開始 ---------- */
  if (window.opener) clients.push(window.opener);
  needOSD().then(function () {
    makeViewer(); layout();
    var want = wantedFromUrl() || idOf((document.getElementById('span_scanID') || {}).textContent);
    if (want) openSlide(want, goFromUrl());
    else if (window.opener) {
      try { window.opener.postMessage({ pd: 1, t: 'want' }, APP); } catch (e) {}
      setTimeout(function () { if (!sid) { document.getElementById('pdh-i').textContent = '在右邊輸入片號，按「換片」'; document.getElementById('pdh-q').focus(); } }, 1500);
    } else { document.getElementById('pdh-i').textContent = '在右邊輸入片號，按「換片」'; document.getElementById('pdh-q').focus(); }
  }).catch(function (err) { try { console.error('[pdh]', err && err.stack || err); } catch (e) {} toast('載入看片程式失敗。請確認有連校內網路或台大 VPN。', 7000); });
})();

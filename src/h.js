/* 抽號器看片書籤：在 microteaching 的清單頁自動開片；在看片頁鎖定 4×/10×/40× 實際倍率的圓形視野。
   只改變使用者自己瀏覽器裡的顯示，不改台大伺服器上的任何東西。 */
(function () {
  'use strict';
  var me = document.currentScript && document.currentScript.src;
  var APP = me ? new URL(me).origin : 'https://pathology-draw.firebaseapp.com';
  var FIELD = { 4: 5500, 10: 2200, 40: 550 }; /* 視野直徑 µm：10× 目鏡、視野數 22 */
  var OBJS = [4, 10, 40];

  function toast(t, ms) {
    var d = document.getElementById('pdh-toast');
    if (!d) { d = document.createElement('div'); d.id = 'pdh-toast'; d.style.cssText = 'position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:2147483647;background:#1d2b36;color:#fff;font:15px/1.5 system-ui,sans-serif;padding:8px 14px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.4);max-width:90vw'; document.body.appendChild(d); }
    d.textContent = t; d.style.display = 'block';
    clearTimeout(d._t); if (ms !== 0) d._t = setTimeout(function () { d.style.display = 'none'; }, ms || 3500);
  }

  if (window.Pviewer && window.Pviewer.viewport) return viewer();
  if (document.querySelector('table') && /ScanID/.test(document.body.textContent)) return list();
  alert('抽號器看片：請在 microteaching 的「片子清單」或「看片畫面」再按一次。');

  /* ---------- 清單頁：開指定的片 ---------- */
  function list() {
    var asked = false;
    function go(id) {
      id = String(id || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!id) return;
      if (/^\d{1,4}$/.test(id)) id = 'PA' + ('0000' + id).slice(-4);
      var re = new RegExp('ScanID:\\s*' + id.replace(/[^A-Z0-9_]/g, '') + '(?![A-Z0-9_])', 'i'), href = null;
      var rows = window.jQuery && window.jQuery.fn.dataTable ? window.jQuery('table').DataTable().rows().nodes().toArray() : [].slice.call(document.querySelectorAll('tbody tr'));
      rows.some(function (r) { if (re.test(r.textContent.replace(/\s+/g, ' '))) { var a = r.querySelector('a[href*="GestaltViewer"]'); if (a) { href = a.href; return true; } } return false; });
      if (!href) { alert('清單裡找不到 ' + id + '。'); return; }
      toast('抽號器：正在開 ' + id + '…開好後請再按一次書籤，鎖定倍率。', 0);
      location.href = href; /* 同一個分頁開，抽號器才連得到 */
    }
    function ask() { if (asked) return; asked = true; go(prompt('要開哪一張片？輸入線上片號（例：PA0306）', '')); }
    if (window.opener) {
      window.addEventListener('message', function (e) {
        if (e.origin !== APP || !e.data || e.data.pd !== 1 || e.data.t !== 'want-r' || asked) return;
        asked = true; if (e.data.id) go(e.data.id); else { asked = false; ask(); }
      });
      try { window.opener.postMessage({ pd: 1, t: 'want' }, APP); } catch (err) {}
      setTimeout(ask, 1500);
    } else ask();
  }

  /* ---------- 看片頁：圓形視野 + 固定三個實際倍率 ---------- */
  function viewer() {
    var V = window.Pviewer, vp = V.viewport;
    if (window.__pdh) { window.__pdh.again(); return; }
    var sid = (document.getElementById('span_scanID') || {}).textContent;
    sid = String(sid || (document.body.innerText.match(/PA\d{4}(?:_X)?/) || [''])[0]).trim();
    var ppm = V.scalebarInstance && V.scalebarInstance.pixelsPerMeter;
    var mpp = ppm ? 1e6 / ppm : 0.2266; /* µm / 影像像素 */
    var obj = 4, D = 400, zt = null, panel = null, clients = [], busy = false;

    /* 遮罩與控制列 */
    var css = document.createElement('style');
    css.textContent = '#pdh-mask{position:fixed;z-index:2147483000;pointer-events:none;overflow:hidden}' +
      '#pdh-hole{position:absolute;border-radius:50%;box-shadow:0 0 0 300vmax #000;outline:2px solid #3a3a3a}' +
      '#pdh-bar{position:fixed;z-index:2147483001;left:50%;bottom:12px;transform:translateX(-50%);display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:center;background:rgba(20,24,28,.92);color:#fff;padding:6px 8px;border-radius:8px;font:13px/1.3 system-ui,"PingFang TC","Microsoft JhengHei",sans-serif;max-width:96vw}' +
      '#pdh-bar button{font:inherit;border:1px solid #8a97a3;background:#2a333b;color:#fff;border-radius:5px;padding:4px 10px;cursor:pointer}' +
      '#pdh-bar button[aria-pressed=true]{background:#e8eef3;color:#111;font-weight:700}#pdh-bar .i{color:#cfd8df;padding:0 4px}';
    document.head.appendChild(css);
    var mask = document.createElement('div'); mask.id = 'pdh-mask';
    var hole = document.createElement('div'); hole.id = 'pdh-hole'; mask.appendChild(hole);
    var bar = document.createElement('div'); bar.id = 'pdh-bar';
    bar.innerHTML = OBJS.map(function (o) { return '<button type="button" data-o="' + o + '">' + o + '×</button>'; }).join('') +
      '<span class="i" id="pdh-i"></span><button type="button" id="pdh-cap">擷取視野到筆記</button><button type="button" id="pdh-p">答案面板</button><button type="button" id="pdh-x">解除</button>';
    document.body.appendChild(mask); document.body.appendChild(bar);
    var hidden = [];
    ['div_leftBar', 'Div_LeftTop', 'Div_RightTop', 'Div_RightBottom', 'Div_LeftBottom'].forEach(function (k) { hide(document.getElementById(k)); });
    ['max', 'fit', 'slider-vertical', 'amount'].forEach(function (k) { /* 原本的倍率滑桿、x80、Fit 整塊藏起來 */
      var e = document.getElementById(k); while (e && e !== document.body && !/absolute|fixed/.test(getComputedStyle(e).position)) e = e.parentElement;
      if (e && e !== document.body && !e.contains(V.container) && hidden.every(function (h) { return h[0] !== e; })) hide(e);
    });
    function hide(e) { if (e) { hidden.push([e, e.style.display]); e.style.display = 'none'; } }

    /* 停用原本的縮放方式：滾輪、點擊、雙擊、雙指、數字鍵 */
    var gs = ['gestureSettingsMouse', 'gestureSettingsTouch', 'gestureSettingsPen', 'gestureSettingsUnknown'], saved = {};
    gs.forEach(function (k) { if (V[k]) { saved[k] = { s: V[k].scrollToZoom, c: V[k].clickToZoom, d: V[k].dblClickToZoom, p: V[k].pinchToZoom }; V[k].scrollToZoom = V[k].clickToZoom = V[k].dblClickToZoom = V[k].pinchToZoom = false; } });
    var wheelT = 0;
    function onWheel(e) { if (!inBox(e)) return; e.preventDefault(); e.stopImmediatePropagation(); var t = Date.now(); if (t - wheelT < 280) return; wheelT = t; step(e.deltaY < 0 ? 1 : -1); }
    function onKey(e) {
      var tg = e.target && e.target.tagName; if (tg === 'INPUT' || tg === 'TEXTAREA') return;
      if (/^[1-5]$/.test(e.key) || e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
        e.preventDefault(); e.stopImmediatePropagation();
        if (e.type === 'keydown') { if (e.key === '+' || e.key === '=') step(1); else if (e.key === '-' || e.key === '_') step(-1); }
      }
    }
    var lastPinch = 0;
    function onTouch(e) { if (e.touches && e.touches.length > 1) { e.preventDefault(); e.stopImmediatePropagation(); } }
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKey, true); window.addEventListener('keypress', onKey, true);
    V.container.addEventListener('touchstart', onTouch, { capture: true, passive: false });
    function inBox(e) { var r = V.container.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; }

    function zoomFor(o) { var umPerPx = FIELD[o] / D, iz = mpp / umPerPx; return vp.imageToViewportZoom(iz); }
    function layout() {
      var r = V.container.getBoundingClientRect();
      D = Math.max(160, Math.floor(Math.min(r.width, r.height) * 0.94));
      mask.style.left = r.left + 'px'; mask.style.top = r.top + 'px'; mask.style.width = r.width + 'px'; mask.style.height = r.height + 'px';
      hole.style.width = hole.style.height = D + 'px'; hole.style.left = (r.width - D) / 2 + 'px'; hole.style.top = (r.height - D) / 2 + 'px';
    }
    function apply(immediate) {
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
    function onZoom() { if (busy || zt == null) return; var tgt = vp.getZoom(); if (Math.abs(tgt / zt - 1) > 0.02) { busy = true; vp.zoomTo(zt, null, false); busy = false; } }
    V.addHandler('zoom', onZoom);
    function onResize() { setTimeout(function () { apply(true); }, 60); }
    window.addEventListener('resize', onResize);
    if (V.addHandler) V.addHandler('resize', onResize);

    function center() { var p = vp.viewportToImageCoordinates(vp.getCenter(true)); return { x: Math.round(p.x), y: Math.round(p.y) }; }
    function state() { var c = center(); return { pd: 1, t: 'view', id: sid, x: c.x, y: c.y, obj: obj, mpp: mpp }; }
    var vt = null;
    V.addHandler('animation-finish', function () { clearTimeout(vt); vt = setTimeout(function () { send(state()); }, 150); });
    function goTo(x, y, o) {
      if (OBJS.indexOf(o) >= 0) obj = o;
      apply(false);
      vp.panTo(vp.imageToViewportCoordinates(new OpenSeadragon.Point(+x, +y)), false);
    }

    function capture() {
      var cv = V.drawer && V.drawer.canvas; if (!cv || !cv.getContext) throw new Error('canvas');
      var r = V.container.getBoundingClientRect(), k = cv.width / r.width;
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

    function alive(w) { try { return w && !w.closed; } catch (e) { return false; } }
    function send(o, only) { clients = clients.filter(alive); (only ? [only] : clients).forEach(function (w) { try { w.postMessage(o, APP); } catch (e) {} }); }
    function hello() { var s = state(); s.t = 'hello'; return s; }
    window.addEventListener('message', function (e) {
      if (e.origin !== APP || !e.data || e.data.pd !== 1) return;
      var m = e.data, src = e.source;
      if (src && clients.indexOf(src) < 0) clients.push(src);
      if (m.t === 'hi') send(hello(), src);
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
      else if (b.id === 'pdh-cap') {
        var c; try { c = capture(); } catch (err) { toast('擷取失敗：這個瀏覽器不允許讀取畫面。'); return; }
        var to = alive(panel) ? panel : clients.filter(alive)[0];
        if (!to) { toast('先按「答案面板」並登入抽號器，擷取的圖才會存到你的筆記。', 5000); return; }
        send(c, to); toast('已送到答案面板，存進「' + sid + '」的筆記。');
      } else if (b.id === 'pdh-p') openPanel();
      else if (b.id === 'pdh-x') off();
    });
    function off() {
      window.removeEventListener('wheel', onWheel, { capture: true }); window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKey, true); window.removeEventListener('keypress', onKey, true);
      V.container.removeEventListener('touchstart', onTouch, { capture: true }); window.removeEventListener('resize', onResize);
      V.removeHandler('zoom', onZoom); zt = null;
      gs.forEach(function (k) { if (saved[k]) { V[k].scrollToZoom = saved[k].s; V[k].clickToZoom = saved[k].c; V[k].dblClickToZoom = saved[k].d; V[k].pinchToZoom = saved[k].p; } });
      hidden.forEach(function (h) { h[0].style.display = h[1]; });
      mask.remove(); bar.remove(); css.remove(); window.__pdh = null;
      toast('已解除鎖定。再按一次書籤可以重新鎖定。');
    }
    window.__pdh = { again: function () { apply(true); openPanel(); send(hello()); }, goTo: goTo, setObj: setObj, capture: capture, state: state };

    apply(true);
    if (window.opener) { clients.push(window.opener); }
    send(hello());
    openPanel();
    if (!ppm) toast('讀不到這張片的掃描解析度，暫用 0.2266 µm/像素計算倍率。', 6000);
  }
})();

/*
 * Designer page agent. Injected into previewed pages (files we serve, and pages shown through the
 * local proxy). It owns element hover/selection and the selection overlay, and applies style edits
 * on request. It stays completely inert unless the Designer app (the parent window, on an allowed
 * origin) talks to it. Plain JS on purpose: it runs inside arbitrary pages and has no build step.
 *
 * Protocol (postMessage, always tagged { designer: 1 }):
 *   app -> page:  hello | enable {on} | select {id} | deselect | apply {id, props} | reset {id?}
 *   page -> app:  ready | selected {el} | deselected | log {edits} | hover {el}
 */
(function () {
  'use strict';
  if (window.__designerAgent || window.parent === window) return;
  window.__designerAgent = true;

  var tag = document.currentScript || document.querySelector('script[data-designer-agent]');
  var ORIGINS = ((tag && tag.getAttribute('data-origins')) || '').split(',').filter(Boolean);
  var parentOrigin = null;
  function send(m) {
    if (!parentOrigin) return;
    m.designer = 1;
    window.parent.postMessage(m, parentOrigin);
  }

  // ---------- element identity ----------
  var nextId = 1;
  var ids = new WeakMap();
  var byId = new Map();
  function idOf(el) {
    var id = ids.get(el);
    if (!id) {
      id = 'e' + nextId++;
      ids.set(el, id);
      byId.set(id, new WeakRef(el));
    }
    return id;
  }
  function elById(id) {
    var r = byId.get(id);
    var el = r && r.deref();
    return el && el.isConnected ? el : null;
  }

  function label(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    var cls = Array.prototype.slice.call(el.classList, 0, 2);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  }
  function selectorPart(el) {
    var s = el.tagName.toLowerCase();
    if (el.id) return s + '#' + CSS.escape(el.id);
    var cls = Array.prototype.filter.call(el.classList, function (c) { return c.length < 40; }).slice(0, 2);
    s += cls.map(function (c) { return '.' + CSS.escape(c); }).join('');
    var p = el.parentElement;
    if (p) {
      var same = Array.prototype.filter.call(p.children, function (c) { return c.tagName === el.tagName; });
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
    }
    return s;
  }
  function selectorFor(el) {
    var parts = [];
    var cur = el;
    for (var i = 0; cur && cur.nodeType === 1 && i < 6; i++) {
      parts.unshift(selectorPart(cur));
      var sel = parts.join(' > ');
      try {
        if (document.querySelectorAll(sel).length === 1 && document.querySelector(sel) === el) return sel;
      } catch (e) { /* invalid selector: keep climbing */ }
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }
  function ownText(el) {
    var t = '';
    for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) t += ' ' + n.textContent;
    t = t.replace(/\s+/g, ' ').trim();
    if (!t) t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 80);
  }

  // ---------- edits ----------
  var edits = new Map(); // el -> { id, order, origStyleAttr, props: Map(prop -> { from, to, inline, prio }) }
  var order = 0;
  var PROPS = [
    'display', 'flex-direction', 'flex-wrap', 'gap', 'align-items', 'justify-content', 'overflow',
    'width', 'height', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'opacity', 'visibility', 'border-radius', 'background-color',
    'border-top-width', 'border-top-style', 'border-top-color', 'box-shadow',
    'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
    'translate', 'rotate', 'position', 'box-sizing'
  ];
  var COLOR = /color$/;

  function computed(el, p) { return getComputedStyle(el).getPropertyValue(p); }

  function applyProps(el, props) {
    var rec = edits.get(el);
    if (!rec) {
      rec = { id: idOf(el), order: order++, origStyleAttr: el.getAttribute('style'), props: new Map() };
      edits.set(el, rec);
    }
    Object.keys(props).forEach(function (p) {
      var v = props[p];
      var cur = rec.props.get(p);
      if (v === null || v === undefined || v === '') return resetProp(el, rec, p);
      if (!cur) {
        cur = { from: computed(el, p), to: '', inline: el.style.getPropertyValue(p), prio: el.style.getPropertyPriority(p) };
        rec.props.set(p, cur);
      }
      el.style.setProperty(p, String(v), 'important');
      cur.to = p === 'translate' || p === 'rotate' ? String(v) : computed(el, p);
      // an edit that lands back on the original rendering is not a change
      if (cur.to === cur.from) resetProp(el, rec, p);
    });
    if (!rec.props.size) edits.delete(el);
  }
  function resetProp(el, rec, p) {
    var cur = rec.props.get(p);
    if (cur) {
      if (cur.inline) el.style.setProperty(p, cur.inline, cur.prio);
      else el.style.removeProperty(p);
    } else el.style.removeProperty(p);
    rec.props.delete(p);
  }
  function resetEl(el) {
    var rec = edits.get(el);
    if (!rec) return;
    Array.from(rec.props.keys()).forEach(function (p) { resetProp(el, rec, p); });
    if (rec.origStyleAttr === null && el.getAttribute('style') === '') el.removeAttribute('style');
    edits.delete(el);
  }
  function cleanHtml(el) {
    var c = el.cloneNode(true);
    var rec = edits.get(el);
    if (rec) {
      if (rec.origStyleAttr === null) c.removeAttribute('style');
      else c.setAttribute('style', rec.origStyleAttr);
    }
    var h = c.outerHTML.replace(/\s+/g, ' ');
    return h.length > 240 ? h.slice(0, 237) + '…' : h;
  }
  function logPayload() {
    var out = [];
    edits.forEach(function (rec, el) {
      var changes = [];
      rec.props.forEach(function (c, p) { changes.push({ prop: p, from: c.from, to: c.to }); });
      out.push({ id: rec.id, order: rec.order, label: label(el), selector: selectorFor(el), text: ownText(el), html: cleanHtml(el), changes: changes });
    });
    out.sort(function (a, b) { return a.order - b.order; });
    return out;
  }

  // ---------- describing an element for the panel ----------
  function moveOf(el) {
    var t = computed(el, 'translate');
    if (!t || t === 'none') return { x: 0, y: 0 };
    var p = t.split(/\s+/);
    return { x: parseFloat(p[0]) || 0, y: parseFloat(p[1]) || 0 };
  }
  function rotOf(el) { return parseFloat(computed(el, 'rotate')) || 0; }
  function rectOf(r) { return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; }
  function describe(el) {
    var style = {};
    PROPS.forEach(function (p) { style[p] = computed(el, p); });
    var path = [];
    for (var a = el.parentElement; a && path.length < 8; a = a.parentElement) path.unshift({ id: idOf(a), label: label(a) });
    return {
      id: idOf(el), tag: el.tagName.toLowerCase(), label: label(el), selector: selectorFor(el), text: ownText(el), html: cleanHtml(el),
      path: path, rect: rectOf(el.getBoundingClientRect()), parent: el.parentElement ? rectOf(el.parentElement.getBoundingClientRect()) : null,
      style: style, move: moveOf(el), rot: rotOf(el), hasText: !!ownText(el), childCount: el.children.length
    };
  }

  // ---------- overlay ----------
  var host = null, root = null, hoverBox = null, selBox = null, pill = null;
  function buildOverlay() {
    if (host) return;
    host = document.createElement('div');
    host.setAttribute('data-designer-overlay', '');
    host.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.box{position:fixed;display:none;box-sizing:border-box;pointer-events:none}' +
      '.hover{border:1px solid #3b82f6;background:rgba(59,130,246,.08)}' +
      '.sel{border:1.5px solid #3b82f6}' +
      '.sel i{position:absolute;width:8px;height:8px;background:#fff;border:1.5px solid #3b82f6;box-sizing:border-box;pointer-events:auto;touch-action:none}' +
      '.sel i[data-h=nw]{left:-5px;top:-5px;cursor:nwse-resize}.sel i[data-h=ne]{right:-5px;top:-5px;cursor:nesw-resize}' +
      '.sel i[data-h=sw]{left:-5px;bottom:-5px;cursor:nesw-resize}.sel i[data-h=se]{right:-5px;bottom:-5px;cursor:nwse-resize}' +
      '.pill{position:absolute;left:50%;top:100%;transform:translate(-50%,6px);background:#3b82f6;color:#fff;font:600 11px/1 system-ui,sans-serif;padding:4px 6px;border-radius:4px;white-space:nowrap;pointer-events:none}' +
      '</style>' +
      '<div class="box hover"></div>' +
      '<div class="box sel"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i><b class="pill"></b></div>';
    hoverBox = root.querySelector('.hover');
    selBox = root.querySelector('.sel');
    pill = root.querySelector('.pill');
    root.querySelectorAll('i').forEach(function (h) { h.addEventListener('pointerdown', startResize); });
    document.documentElement.appendChild(host);
  }
  function place(box, el) {
    if (!el || !el.isConnected) { box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
  }
  function fmt(n) { return Math.round(n * 10) / 10; }

  // ---------- selection ----------
  var enabled = false, selected = null, hovered = null, raf = 0;
  function frame() {
    raf = 0;
    if (!enabled) return;
    place(hoverBox, hovered && hovered !== selected ? hovered : null);
    place(selBox, selected);
    if (selected && selected.isConnected) {
      var r = selected.getBoundingClientRect();
      pill.textContent = fmt(r.width) + ' × ' + fmt(r.height);
    }
    raf = requestAnimationFrame(frame);
  }
  function select(el) {
    selected = el;
    if (!el) { send({ type: 'deselected' }); return; }
    send({ type: 'selected', el: describe(el) });
  }
  function refresh() { if (selected && selected.isConnected) send({ type: 'selected', el: describe(selected) }); send({ type: 'log', edits: logPayload() }); }
  var refreshQueued = false;
  function refreshSoon() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(function () { refreshQueued = false; refresh(); });
  }
  function pick(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el || el === host) return null;
    return el;
  }

  // ---------- pointer handling (only while enabled) ----------
  var drag = null;
  var SWALLOW = ['click', 'mousedown', 'mouseup', 'dblclick', 'auxclick', 'contextmenu', 'submit', 'pointerup', 'touchstart'];
  function swallow(e) {
    if (e.target === host) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }
  function onMove(e) {
    if (drag && drag.kind === 'move') {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      drag.moved = true;
      applyProps(drag.el, { translate: Math.round(drag.start.x + dx) + 'px ' + Math.round(drag.start.y + dy) + 'px' });
      refreshSoon();
      return;
    }
    if (e.target === host) return;
    hovered = pick(e.clientX, e.clientY);
  }
  function onDown(e) {
    if (e.target === host || e.button !== 0) return;
    var el = pick(e.clientX, e.clientY);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    select(el);
    if (el !== document.documentElement && el !== document.body) drag = { kind: 'move', el: el, x: e.clientX, y: e.clientY, start: moveOf(el), moved: false };
  }
  function onUp() {
    if (drag && drag.kind === 'move') { var d = drag; drag = null; if (d.moved) refresh(); }
  }
  function startResize(e) {
    if (!selected) return;
    e.preventDefault();
    e.stopPropagation();
    var el = selected;
    var cs = getComputedStyle(el);
    var h = e.target.getAttribute('data-h');
    var st = { w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0, m: moveOf(el), x: e.clientX, y: e.clientY };
    var t = e.target;
    t.setPointerCapture(e.pointerId);
    function mv(ev) {
      var dx = ev.clientX - st.x, dy = ev.clientY - st.y;
      var w = st.w + (h.indexOf('e') >= 0 ? dx : -dx);
      var hh = st.h + (h.indexOf('s') >= 0 ? dy : -dy);
      var p = { width: Math.max(1, Math.round(w)) + 'px', height: Math.max(1, Math.round(hh)) + 'px' };
      var tx = st.m.x + (h.indexOf('w') >= 0 ? dx : 0);
      var ty = st.m.y + (h.indexOf('n') >= 0 ? dy : 0);
      if (h.indexOf('w') >= 0 || h.indexOf('n') >= 0) p.translate = Math.round(tx) + 'px ' + Math.round(ty) + 'px';
      applyProps(el, p);
      refreshSoon();
    }
    function up() { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', up); refresh(); }
    t.addEventListener('pointermove', mv);
    t.addEventListener('pointerup', up);
  }
  function onKey(e) {
    var tg = e.target;
    if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return;
    if (e.key === 'Escape') { selected = null; select(null); return; }
    if (!selected || e.key.indexOf('Arrow') !== 0) return;
    e.preventDefault();
    var step = e.shiftKey ? 10 : 1, m = moveOf(selected);
    var dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    var dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    applyProps(selected, { translate: (m.x + dx) + 'px ' + (m.y + dy) + 'px' });
    refresh();
  }

  function enable(on) {
    if (on === enabled) return;
    enabled = on;
    if (on) {
      buildOverlay();
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerdown', onDown, true);
      window.addEventListener('pointerup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      SWALLOW.forEach(function (n) { window.addEventListener(n, swallow, true); });
      raf = requestAnimationFrame(frame);
      send({ type: 'log', edits: logPayload() });
    } else {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      SWALLOW.forEach(function (n) { window.removeEventListener(n, swallow, true); });
      cancelAnimationFrame(raf);
      hovered = null;
      if (host) { hoverBox.style.display = 'none'; selBox.style.display = 'none'; }
      selected = null;
      send({ type: 'deselected' });
    }
  }

  // ---------- messages from the app ----------
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return; // only the embedding Designer window
    if (ORIGINS.indexOf(e.origin) < 0) return; // and only from the app's own origins
    var m = e.data;
    if (!m || m.designer !== 1) return;
    parentOrigin = e.origin;
    var el;
    switch (m.type) {
      case 'hello': send({ type: 'ready', url: location.href }); break;
      case 'enable': enable(!!m.on); break;
      case 'select': el = elById(m.id); if (el) select(el); break;
      case 'deselect': selected = null; select(null); break;
      case 'apply': el = elById(m.id); if (el) { applyProps(el, m.props || {}); refresh(); } break;
      case 'reset':
        if (m.id) { el = elById(m.id); if (el) resetEl(el); }
        else Array.from(edits.keys()).forEach(resetEl);
        refresh();
        break;
    }
  });
})();

/* ==========================================================
   Compass Arena — просмотрщик турнирной сетки
   ----------------------------------------------------------
   Окно во весь экран, в котором двигается готовое полотно сетки:
     • перетаскивание мышью и пальцем;
     • колесо — прокрутка, Shift + колесо — вбок, Ctrl + колесо
       (и щипок на тачпаде / телефоне) — масштаб к точке под курсором;
     • кнопки «−», «100%», «+», «По ширине», «Вся сетка», «К ближайшему матчу»;
     • клавиатура: стрелки, + / −, 0 (по ширине), 9 (вся сетка).
   Полотно — это .bracket с готовыми размерами (data-w / data-h), а положение
   и масштаб задаются переменными --tx, --ty, --s: никакой пересборки при
   движении, поэтому плавно даже на большой сетке.
   ========================================================== */
(function (global) {
  'use strict';

  var CA = global.CA = global.CA || {};

  var MIN_SCALE = 0.2;
  var MAX_SCALE = 1.8;
  var PAD = 40;                 /* поле вокруг полотна, px */

  function create(canvas, opts) {
    opts = opts || {};
    var st = { s: 1, tx: 0, ty: 0, W: 0, H: 0, ready: false };
    var pointers = {};
    var drag = null;
    var pinch = null;
    var justDragged = false;
    var animTimer = null;

    function bracket() { return canvas.querySelector('.bracket'); }
    function box() { return { w: canvas.clientWidth || 0, h: canvas.clientHeight || 0 }; }
    function count(o) { return Object.keys(o).length; }

    function measure() {
      var b = bracket();
      if (!b) return false;
      st.W = Number(b.getAttribute('data-w')) || 0;
      st.H = Number(b.getAttribute('data-h')) || 0;
      return !!(st.W && st.H);
    }

    /* Полотно меньше окна — по центру; больше — не уводим дальше поля PAD */
    function clampPan() {
      var c = box();
      if (!c.w || !c.h) return;
      var w = st.W * st.s;
      var h = st.H * st.s;
      st.tx = (w + 2 * PAD <= c.w) ? (c.w - w) / 2 : Math.min(PAD, Math.max(c.w - w - PAD, st.tx));
      st.ty = (h + 2 * PAD <= c.h) ? (c.h - h) / 2 : Math.min(PAD, Math.max(c.h - h - PAD, st.ty));
    }

    function apply(animate) {
      var b = bracket();
      if (!b) return;
      if (animate) {
        b.classList.add('is-anim');
        clearTimeout(animTimer);
        animTimer = setTimeout(function () { b.classList.remove('is-anim'); }, 380);
      } else if (b.classList.contains('is-anim')) {
        b.classList.remove('is-anim');
      }
      b.style.setProperty('--s', st.s.toFixed(4));
      b.style.setProperty('--tx', Math.round(st.tx) + 'px');
      b.style.setProperty('--ty', Math.round(st.ty) + 'px');
      if (opts.onChange) opts.onChange(st.s);
    }

    function zoomAt(factor, px, py, animate) {
      if (!measure()) return;
      var ns = Math.min(MAX_SCALE, Math.max(MIN_SCALE, st.s * factor));
      var k = ns / st.s;
      st.tx = px - (px - st.tx) * k;
      st.ty = py - (py - st.ty) * k;
      st.s = ns;
      clampPan();
      apply(animate);
    }

    function zoomCenter(factor) {
      var c = box();
      zoomAt(factor, c.w / 2, c.h / 2, true);
    }

    /** 'width' — по ширине окна (верх сетки у верхнего края), 'all' — вся сетка целиком */
    function fit(mode, animate) {
      if (!measure()) return;
      var c = box();
      if (!c.w || !c.h) { st.s = 1; st.tx = 0; st.ty = 0; apply(false); return; }
      var sw = (c.w - 2 * PAD) / st.W;
      var sh = (c.h - 2 * PAD) / st.H;
      var s = mode === 'all' ? Math.min(sw, sh) : sw;
      st.s = Math.min(1, Math.max(MIN_SCALE, s));
      st.tx = 0;
      st.ty = PAD;
      clampPan();
      apply(animate);
      st.ready = true;
    }

    function actual() {
      var c = box();
      zoomAt(1 / st.s, c.w / 2, c.h / 2, true);
    }

    /** Показать матч по центру окна (не мельче 85%) */
    function focus(el) {
      if (!el || !measure()) return;
      var c = box();
      var left = parseFloat(el.style.left) || 0;
      var top = parseFloat(el.style.top) || 0;
      var w = parseFloat(el.style.width) || 0;
      var h = parseFloat(el.style.height) || 0;
      st.s = Math.min(MAX_SCALE, Math.max(st.s, 0.85));
      st.tx = c.w / 2 - (left + w / 2) * st.s;
      st.ty = c.h / 2 - (top + h / 2) * st.s;
      clampPan();
      apply(true);
    }

    function pan(dx, dy, animate) {
      st.tx += dx;
      st.ty += dy;
      clampPan();
      apply(animate);
    }

    /* ---------- Мышь, палец, щипок ---------- */

    function distance(a, b) { return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2)); }

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = count(pointers);
      if (n === 1) {
        drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, tx0: st.tx, ty0: st.ty, active: false };
        pinch = null;
      } else if (n === 2) {
        var ids = Object.keys(pointers);
        pinch = { d0: distance(pointers[ids[0]], pointers[ids[1]]) || 1, s0: st.s };
        drag = null;
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

      if (pinch && count(pointers) >= 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var r = canvas.getBoundingClientRect();
        var d = distance(a, b) || 1;
        var target = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.s0 * d / pinch.d0));
        zoomAt(target / st.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, false);
        return;
      }

      if (!drag || drag.id !== e.pointerId) return;
      var dx = e.clientX - drag.x0;
      var dy = e.clientY - drag.y0;
      if (!drag.active) {
        if (Math.sqrt(dx * dx + dy * dy) < 5) return;
        drag.active = true;
        canvas.classList.add('is-dragging');
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      }
      st.tx = drag.tx0 + dx;
      st.ty = drag.ty0 + dy;
      clampPan();
      apply(false);
    });

    function release(e) {
      delete pointers[e.pointerId];
      if (drag && drag.id === e.pointerId) {
        if (drag.active) {
          justDragged = true;
          setTimeout(function () { justDragged = false; }, 0);
        }
        drag = null;
        canvas.classList.remove('is-dragging');
      }
      if (count(pointers) < 2) pinch = null;
    }
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    /* Если жест был перетаскиванием — клик по слоту не должен открывать команду */
    canvas.addEventListener('click', function (e) {
      if (justDragged) { e.stopPropagation(); e.preventDefault(); }
    }, true);

    /* ---------- Колесо ---------- */

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var k = e.deltaMode === 1 ? 16 : 1;
      var dy = e.deltaY * k;
      var dx = e.deltaX * k;
      if (e.ctrlKey || e.metaKey) {
        var r = canvas.getBoundingClientRect();
        zoomAt(Math.exp(-dy * 0.0022), e.clientX - r.left, e.clientY - r.top, false);
      } else if (e.shiftKey) {
        pan(-(dy || dx), 0, false);
      } else {
        pan(-dx, -dy, false);
      }
    }, { passive: false });

    /* ---------- Клавиатура ---------- */

    canvas.addEventListener('keydown', function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      var handled = true;
      switch (e.key) {
        case 'ArrowLeft': pan(90, 0, true); break;
        case 'ArrowRight': pan(-90, 0, true); break;
        case 'ArrowUp': pan(0, 90, true); break;
        case 'ArrowDown': pan(0, -90, true); break;
        case '+': case '=': zoomCenter(1.25); break;
        case '-': case '_': zoomCenter(0.8); break;
        case '0': fit('width', true); break;
        case '9': fit('all', true); break;
        default: handled = false;
      }
      if (handled) e.preventDefault();
    });

    /* ---------- Публичное ---------- */

    return {
      /** Вызывается после каждой перерисовки сетки: первый раз вписывает по ширине, дальше держит вид */
      sync: function () {
        if (!measure()) return;
        if (!st.ready) fit('width', false);
        else { clampPan(); apply(false); }
      },
      /** Следующее открытие окна снова начнётся с «по ширине» */
      reset: function () { st.ready = false; },
      resize: function () { if (measure()) { clampPan(); apply(false); } },
      fit: fit,
      actual: actual,
      zoomIn: function () { zoomCenter(1.25); },
      zoomOut: function () { zoomCenter(0.8); },
      focus: focus,
      scale: function () { return st.s; }
    };
  }

  CA.bracketViewer = { create: create, MIN_SCALE: MIN_SCALE, MAX_SCALE: MAX_SCALE };
})(typeof window !== 'undefined' ? window : globalThis);

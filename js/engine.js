/* ROLLO — engine.js
 * The governed spine: seeded PRNG, motion/visibility governor (photosensitivity +
 * performance safety), DPR-aware canvas fitting, a governed animation loop, and a tiny
 * asset-free WebAudio synth. No dependencies. No network. One global: window.ROLLO_ENGINE.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  /* ---------- math ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ---------- seeded PRNG (mulberry32) ---------- */
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function newSeed() {
    try {
      if (global.crypto && global.crypto.getRandomValues) {
        var u = new Uint32Array(1); global.crypto.getRandomValues(u); return u[0] >>> 0;
      }
    } catch (e) {}
    return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  }

  /* ---------- color helpers ---------- */
  function _ch(c) {
    if (c.charAt(0) === 'r') {  // 'rgb(r,g,b)' — so mix/desat compose (they couldn't before;
      var m = c.match(/[\d.]+/g); // the biome-pale tint silently mixed from black. ADR-029)
      return [Math.round(+m[0]), Math.round(+m[1]), Math.round(+m[2])];
    }
    var h = c.replace('#', ''); if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; var n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255];
  }
  function mix(hexA, hexB, t) {
    t = clamp(t, 0, 1); var a = _ch(hexA), b = _ch(hexB);
    return 'rgb(' + Math.round(lerp(a[0],b[0],t)) + ',' + Math.round(lerp(a[1],b[1],t)) + ',' + Math.round(lerp(a[2],b[2],t)) + ')';
  }
  function withAlpha(hex, al) {
    var c = _ch(hex);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + al + ')';
  }

  /* ---------- motion / visibility governor ---------- */
  var mq = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var Motion = {
    reduced: !!(mq && mq.matches),
    tabHidden: false,
    _listeners: [],
    shouldAnimate: function () { return !this.tabHidden; },
    onChange: function (fn) { this._listeners.push(fn); }
  };
  document.addEventListener('visibilitychange', function () { Motion.tabHidden = document.hidden; });
  if (mq && mq.addEventListener) mq.addEventListener('change', function (e) {
    Motion.reduced = e.matches;
    Motion._listeners.forEach(function (fn) { try { fn(e.matches); } catch (x) {} });
  });

  /* ---------- DPR-aware canvas fit ---------- */
  function fit(canvas, cap) {
    cap = cap || 2;
    var dpr = Math.min(global.devicePixelRatio || 1, cap);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, dpr: dpr };
  }

  /* ---------- governed animation loop ---------- */
  function loop(step) {
    var raf = 0, last = 0, elapsed = 0, running = false;
    function frame(ts) {
      if (!running) return;
      if (!Motion.shouldAnimate()) { last = ts; raf = requestAnimationFrame(frame); return; }
      var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
      last = ts; elapsed += dt;
      try { step(dt, elapsed); } catch (e) { /* one bad frame must not kill the marsh */ }
      raf = requestAnimationFrame(frame);
    }
    return {
      start: function () { if (!running) { running = true; last = 0; raf = requestAnimationFrame(frame); } },
      stop: function () { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    };
  }

  /* ---------- tiny synth (asset-free) ----------
   * Gentle by design. Master gain low; nothing sudden or loud. Starts only after a
   * user gesture (browser policy + courtesy). Mute toggle owns `enabled`.
   */
  var Audio = {
    ctx: null, master: null, enabled: true, _started: false,
    _ensure: function () {
      if (!this._started) {
        try {
          var AC = global.AudioContext || global.webkitAudioContext;
          if (!AC) return false;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = 0.22;
          this.master.connect(this.ctx.destination);
          this._started = true;
        } catch (e) { return false; }
      }
      // iOS can leave the context 'interrupted' after a call/Siri — resume on anything not running
      if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) {} }
      return true;
    },
    _env: function (type, freq, t0, dur, peak, freqEnd) {
      var c = this.ctx, o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.master);
      o.start(t0); o.stop(t0 + dur + 0.05);
    },
    heart: function () { // the commit: a soft lub
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 68, t, 0.16, 0.5, 46);
    },
    hold: function () { // the stone holds: warm dub + tick
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 92, t, 0.14, 0.38, 60);
      this._env('triangle', 340, t + 0.02, 0.09, 0.10);
    },
    sink: function () { // quiet descending bloop — a cost, not a horror
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 210, t, 0.5, 0.22, 55);
    },
    kindle: function (i) { // a small bell, pentatonic
      if (!this.enabled || !this._ensure()) return;
      var scale = [523.25, 587.33, 659.25, 783.99, 880.0];
      var f = scale[(i || 0) % scale.length];
      var t = this.ctx.currentTime;
      this._env('sine', f, t, 0.7, 0.16);
      this._env('sine', f * 2.01, t, 0.5, 0.05);
    },
    shore: function () { // quiet arrival — three soft tones, no triumph
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 392.0, t, 1.1, 0.10);
      this._env('sine', 493.88, t + 0.25, 1.0, 0.09);
      this._env('sine', 587.33, t + 0.5, 1.2, 0.08);
    },
    grey: function () { // the world going to sleep: a low hush
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 110, t, 1.6, 0.06, 70);
    },
    holdDeep: function () { // held IN SPITE OF doubt: the ordinary hold, answered a third warmer
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 92, t, 0.14, 0.42, 60);
      this._env('triangle', 340, t + 0.02, 0.09, 0.11);
      this._env('sine', 428, t + 0.04, 0.22, 0.06);   // the major third above — warmth for the act
    },
    chordFar: function () { // the distant chord — three soft tones from somewhere across the water
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 261.63, t, 1.6, 0.035);
      this._env('sine', 329.63, t + 0.4, 1.4, 0.028);
      this._env('sine', 392.0, t + 0.8, 1.6, 0.024);
    },
    owl: function () { // life out there in the dark, also crossing
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 330, t, 0.35, 0.045, 305);
      this._env('sine', 305, t + 0.55, 0.6, 0.035, 285);
    },
    owlAnswer: function () { // once a field, the owl is answered — a fifth lower, farther out
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 220, t, 0.35, 0.025, 203);
      this._env('sine', 203, t + 0.55, 0.6, 0.02, 190);
    },
    shorebirds: function () { // far-shore birds: the shore audibly exists before it is visible.
      // Gliding and off the kindle scale on purpose — this must read as life, never as a chime
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 830, t, 0.3, 0.028, 760);
      this._env('sine', 620, t + 0.38, 0.3, 0.028, 560);
    },
    bellAnswer: function () { // the answered bell: a fifth higher, half gain, from the north
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 660, t + 0.8, 1.8, 0.0175);
      this._env('sine', 1319, t + 0.8, 1.2, 0.006);
    },
    heartQuiet: function () { // another ember commits its weight, far off — witness, not presence
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 68, t, 0.16, 0.125, 46);
    },
    confluence: function () { // the untaken road settles: one soft low fifth
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 165, t, 1.2, 0.05);
      this._env('sine', 247.5, t, 1.2, 0.05);
    },
    gloop: function () { // a frog, near the reeds
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 235, t, 0.12, 0.05, 130);
      this._env('sine', 470, t + 0.03, 0.06, 0.02);
    },
    tend: function () { // presence, announced: one low warm tone, held a moment
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 196, t, 0.9, 0.10);
      this._env('sine', 294, t + 0.08, 0.7, 0.05);
    },
    drip: function () { // a single water drip, far off
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 900 + Math.random() * 500, t, 0.10, 0.03, 500);
    },
    bellFar: function () { // a distant bell — forwardness without a goal
      if (!this.enabled || !this._ensure()) return;
      var t = this.ctx.currentTime;
      this._env('sine', 440, t, 1.8, 0.035);
      this._env('sine', 883, t, 1.2, 0.012);
    }
  };

  global.ROLLO_ENGINE = {
    TAU: TAU, clamp: clamp, lerp: lerp, dist: dist, smoothstep: smoothstep,
    rng: rng, newSeed: newSeed, mix: mix, withAlpha: withAlpha,
    Motion: Motion, fit: fit, loop: loop, Audio: Audio
  };
})(window);

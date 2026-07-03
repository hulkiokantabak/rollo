/* ROLLO — rollo.js
 * A small wordless game about courage, after Rollo May.
 *
 *   doubt      — a stone's reflection breaks and wavers; watching it never resolves it —
 *                hesitating over it sinks it. Only your weight resolves a stone.
 *   despair    — the fog never lifts. There is no weather to wait out.
 *   apathy     — stillness lets the world fall asleep (slow desaturation, a pilot-light
 *                floor). Any step wakes it. TENDING (press-and-hold) is presence, not
 *                emptiness: it freezes the ramp — endurance holds the line.
 *   conformity — the Lit Path: certain, warm, sink-proof — and it drains your color and
 *                drifts you backward. Your kindled companion refuses to board, and waits.
 *   foundation — stranded lights kindle as you pass; one walks with you a while, then
 *                settles as a lamp — the marsh slowly strung with lights you lit.
 *   becoming   — every far shore is a sanctuary, and beyond it another field. The game
 *                never declares you done; stopping at a shore is an honored ending.
 *
 * No words in the canvas. No fail state. Crossing 1 is an authored corridor (the dice are
 * hidden; the first lessons are never left to luck). p(hold) is independent of everything
 * rendered — the only honest signal about a stone is your weight landing on it.
 */
(function (global) {
  'use strict';
  var E = global.ROLLO_ENGINE;

  /* ============================= TUNING (council-ratified) ============================= */
  var T = {
    unit: 74,                  // px per world gap
    reach: 1.5,                // one gap (+tolerance)
    fogGeom: 2.5,              // gaps: geometry visibility
    fogGlow: 4.5,              // gaps: light halos carry farther (lamps behind you register)
    pC2: 0.85, pFloor: 0.75,   // RNG hold rates: crossing 2 → floor by crossing 6
    maxSinks: 3,               // per crossing, then silent 100%
    hopMs: 340, splashMs: 1400,
    splashGlowCost: 0.15, splashRecoverS: 8,
    hesOnset: 2.5,             // s of stillness before the adjacent candidate starts to drain
    hesFull: 7.0,              // cumulative s → fully submerged
    hesReverse: 2.0,           // recovery speed multiplier when you move
    nucleateS: 3.0,            // replacement stone forms nearby
    sleepGraceC1: 45, sleepGrace: 20, sleepGraceLate: 12,
    sleepDesatPerS: 1 / 90,    // full desaturation over 90s
    sleepFloor: 0.15,          // world saturation + ember pilot floor
    tendMs: 300,               // press-and-hold = tending
    kindleRadius: 0.8,
    companionSettleMin: 8, companionSettleMax: 14,
    litDriftRamp: [10, 0.05, 30, 0.2], // s→gaps/s ramp (deniability window: nothing before 10s)
    litLeachPerS: 0.03,
    litExitP: 0.78,
    rows: 12, rowsMax: 15,
    camLerp: 0.06,
    bob: 0.35                  // doubtful stones ride lower in the water
  };

  var C = {
    water: '#0d0c0b', horizon: '#171412', warmBand: '#1d1713',
    bone: '#E8E4DC', stone: '#8d867c', stoneDim: '#55504a', stoneDark: '#37332f',
    ember: '#CB6038', emberHot: '#f0a067',
    gold: '#d9b36a',
    grey: '#6B655D'
  };

  /* ---------- biomes: the marsh slowly changes register every few crossings ----------
   * Journey without a destination: palette drift + grace affinity + small layout bias.
   * The fog still never lifts; only the world it hides changes. */
  /* grace pools use duplicate entries as weights (biome affinity, per the texture council) */
  var BIOMES = [
    { name: 'marsh',     water: '#0d0c0b', horizon: '#171412', warm: '#1d1713', pale: 0,
      graces: ['rain', 'fireflies', 'chord', 'moths', 'stirlight', 'frogs', 'moon', 'owl', 'shorebirds', 'none'],
      shapeFam: 'moss' },
    { name: 'reeds',     water: '#0d0d09', horizon: '#191611', warm: '#1e1a12', pale: 0.04,
      graces: ['frogs', 'frogs', 'fireflies', 'rain', 'chord', 'owl', 'moths', 'shorebirds', 'shorebirds'], reeds: true,
      shapeFam: 'river' },
    { name: 'openwater', water: '#0b0c0d', horizon: '#141619', warm: '#191a1e', pale: -0.03,
      graces: ['stars', 'stars', 'aurora', 'chord', 'moon', 'stirlight', 'none'], wide: true,
      shapeFam: 'river' },
    { name: 'winter',    water: '#0c0d0e', horizon: '#16181b', warm: '#1b1c20', pale: 0.15,
      graces: ['snow', 'snow', 'stars', 'aurora', 'chord'],   // no moths in frost
      shapeFam: 'shale' },
    { name: 'nightrain', water: '#0a0a0b', horizon: '#131315', warm: '#171618', pale: -0.01,
      graces: ['rain', 'rain', 'chord', 'owl', 'fireflies', 'stirlight'], rainy: true,
      shapeFam: 'shale' }
  ];
  /* stone-shape families: one per field — coherence reads as geology, not noise */
  var SHAPE_FAMS = {
    moss:  { n: 10, rBase: 0.33, rVar: 0.04 },
    river: { n: 8,  rBase: 0.32, rVar: 0.06 },
    shale: { n: 12, rBase: 0.28, rVar: 0.12 }
  };
  function biomeFor(d) { return BIOMES[Math.floor(d / 3) % BIOMES.length]; }

  /* deepenings: one per field, each a new shape of the SAME doubt — never stacked, never
   * repeated back-to-back, always paired with a grace. Each entry: [name, unlockDepth].
   *
   * STANDING CANON (texture council, ratified — do not violate):
   *  (a) never weight the dice by what is on screen, and never weight what is on screen by
   *      the dice — the only honest signal about a stone is your weight landing on it;
   *  (b) no texture may give tending, kindling, or any grace a mechanical or informational
   *      payoff — answers are luminous and audible only;
   *  (c) NEVER BUILD "lamps that go out": any built-thing-erodes-unless-serviced mechanic
   *      (decaying lamps, fog re-thickening behind you, a starving companion) reinstates
   *      fear as the engine and inverts the foundation clause. What courage builds is
   *      allowed to keep existing;
   *  (d) life-textures never scale into an economy — fixed caps only;
   *  (e) graces that answer an ACT are deterministic; only field-flavor is random;
   *  (f) RENDER CADENCE (ADR-030, council-ratified): the draw rate derives from `sleeping`
   *      plus a presentation-only input-attention latch — from idleness and raw device input
   *      ONLY, never from p(hold), stone state, field content, tending, kindling, or graces;
   *      the latch may only ADD draws, never remove them; the sleeping marsh renders slower,
   *      NEVER zero — a frozen visible marsh would be a lamp that goes out; the coupling is
   *      one-way — power economy inherits the fiction's clocks (grace periods, the ~90s ramp,
   *      the 0.985 threshold, the sleep floor) and may never tune them; an idleness-timer
   *      downshift outside `sleeping` is PERMANENTLY rejected; deepening the skip below the
   *      ~20fps floor requires council re-ratification. */
  var DEEPENINGS = [
    ['drift', 2], ['twins', 2], ['narrows', 2], ['fogfloor', 2],
    ['latestones', 6],       // off-route footing surfaces only after you commit to the span
    ['rememberdoubt', 6],    // some held stones keep their broken mirror — carried, not cured
    ['fork', 7]              // the route splits around a dark pool: comparison doubt — "is my
                             // line the right line" — and the confluence forgives the choice
  ];

  /* ============================= STATE ============================= */
  var canvas, X, W = 0, H = 0;
  var rand, seed0 = E.newSeed();
  var depth = 0, crossings = 0, fieldH = T.rows;
  var stones = [], litPath = [];
  var player, companion = null, lamps = [];   // lamps persist per-field as settled lights
  var kindledThisCrossing = 0, sinksThisCrossing = 0, lastWasSink = false;
  var cam = { x: 0, y: 0 };
  var sleep = 0, sleeping = false;            // 0..1 world desaturation
  var tending = false, tendHeld = 0;
  var firstStepEver = false, firstLitExitDone = false;
  var onShore = true;                          // start shore sanctuary
  var now = 0, lastStepAt = 0, arriving = false, arriveT = 0;
  var invalidPulse = 0;                        // reachable-stones pulse timer
  var attract = 0;                             // pre-first-step invitation
  /* per-field character: biome + at most ONE deepening (or one rare event) + one grace.
   * The pairing law: any field that carries a new pressure also carries a grace. */
  var field = { biome: BIOMES[0], deepening: null, event: null, fogGeom: 2.5, grace: 'none',
                fam: { n: 10, rBase: 0.33, rVar: 0.04 }, rseed: 1 };
  var lastDeepening = null, lastGrace = null;  // no-repeat windows of 1
  var nextRareAt = 0, pressureStreak = 0;      // scheduled rares + the breath rule
  var raresSeen = 0, stillwaterSeen = false;   // the still water reaches everyone early
  var stirs = [];                              // stirred-light speckles (act-answer grace)
  var lastStir = 0, lastGraceSfx = 0;
  var lastBellAt = 0, lastDripAt = 0;
  var hoverStone = null, lastDir = { x: 0, y: 1 };
  var scriptC1 = null;                         // crossing-1 authored corridor bookkeeping
  var drownsThisSpell = 0;                     // hesitation cap per idle spell (reset on any step)
  /* render cadence (ADR-030): presentation-only — none of this ever touches game state */
  var lastDrawTs = 0, lastInputAt = 0, pointerHeld = false, keysDown = {}, keysHeld = 0;
  var forceDraw = true, wasSleeping = false, paintedFrames = 0, skippedFrames = 0;

  function mkStone(x, y, p, o) {
    o = o || {};
    return {
      x: x, y: y, p: p,
      state: o.state || 'ghost',   // ghost | solid | sunkPerm | drowned (hesitated away)
      hes: 0,                      // hesitation accumulation (s)
      phase: (rand() * E.TAU),
      shape: mkShape(),
      lit: !!o.lit, light: !!o.light, lightKindled: false,
      clampFade: !!o.clampFade,    // C1 stone 4: can never fully drown
      script: o.script || null,    // 'hold' | 'sink' (authored resolution)
      pulseT: 0
    };
  }
  function mkShape() {
    var f = field.fam || { n: 10, rBase: 0.30, rVar: 0.10 };
    var pts = [];
    for (var i = 0; i < f.n; i++) pts.push({ a: (i / f.n) * E.TAU, r: f.rBase + rand() * f.rVar });
    return pts;
  }

  /* ======================== FIELDS ======================== */
  function holdP() {
    if (depth <= 0) return 1;                 // C1 is authored
    var t = Math.min(1, (depth - 1) / 5);
    return E.lerp(T.pC2, T.pFloor, t);
  }

  function genField() {
    rand = E.rng((seed0 + depth * 2654435761) >>> 0);
    stones = []; litPath = []; lamps = [];
    companion = null; kindledThisCrossing = 0; sinksThisCrossing = 0; lastWasSink = false;
    fieldH = Math.min(T.rowsMax, T.rows + Math.max(0, depth - 1));

    /* -------- this field's character: biome, ONE deepening or ONE rare event, one grace ----
     * Depth 0-1: plain marsh (the teaching fields). Rare events are SCHEDULED (first at
     * crossing 4-7, then every 5-11 fields — never streaky, never starved) and replace the
     * deepening. Deepenings unlock by depth, never repeat back-to-back. THE BREATH RULE: if
     * the last three fields all carried pressure, this one rests. THE PAIRING LAW: pressure
     * never arrives without a grace; a grace never repeats back-to-back. */
    field = { biome: biomeFor(depth), deepening: null, event: null, fogGeom: 2.5, grace: 'none', fam: null };
    field._bornAt = now;
    field.fam = (rand() < 0.6) ? SHAPE_FAMS[field.biome.shapeFam]
              : SHAPE_FAMS[['moss', 'river', 'shale'][Math.floor(rand() * 3)]];
    if (nextRareAt === 0) nextRareAt = 4 + Math.floor(rand() * 4);        // first: crossing 4-7
    var breathe = pressureStreak >= 3;
    if (!breathe && depth >= nextRareAt) {
      var EVENTS = ['causeway', 'island', 'companions', 'stillwater'];
      if (depth >= 5) EVENTS.push('othertraveler');   // another ember, far off — witness, not watcher
      field.event = EVENTS[Math.floor(rand() * EVENTS.length)];
      // the expansion's deepest idea must live within human reach: the still water is
      // guaranteed among a player's first three rare encounters
      raresSeen++;
      if (field.event === 'stillwater') stillwaterSeen = true;
      else if (raresSeen >= 3 && !stillwaterSeen) { field.event = 'stillwater'; stillwaterSeen = true; }
      nextRareAt = depth + 5 + Math.floor(rand() * 7);                    // next: +5..11
    } else if (!breathe && depth >= 2) {
      var pool = DEEPENINGS.filter(function (d) { return d[1] <= depth && d[0] !== lastDeepening; });
      if (pool.length) {
        field.deepening = pool[Math.floor(rand() * pool.length)][0];
        lastDeepening = field.deepening;
        if (field.deepening === 'fogfloor') field.fogGeom = Math.max(2.0, 2.5 - 0.08 * depth);
        if (field.deepening === 'fork') field._forkRow = 3 + Math.floor(rand() * (fieldH - 9)); // rows [3, fieldH-7]
      }
    }
    pressureStreak = (field.deepening || field.event) ? pressureStreak + 1 : 0;
    // grace: biome affinity pool (duplicates = weight); non-'none' under pressure; no repeat
    var gpool = field.biome.graces.filter(function (g) { return g !== lastGrace; });
    if (field.deepening || field.event) gpool = gpool.filter(function (g) { return g !== 'none'; });
    if (breathe) gpool = gpool.filter(function (g) { return g !== 'none'; }); // a rest field is a gift, not an absence
    field.grace = gpool[Math.floor(rand() * gpool.length)] || 'none';
    lastGrace = field.grace === 'none' ? lastGrace : field.grace;
    field.rseed = Math.floor(rand() * 1e9);   // per-field render seed for grace layouts
    // the answered bell (audio-layer rare, ADR-029): 1/12 of fields from crossing 3 are armed.
    // Arming is field-flavor randomness (law e's permitted tier); the answer, given the
    // coincidence, is deterministic. Stillwater fields are never armed — that field's bell is
    // an acknowledgment, not a question.
    field._bellArmed = depth >= 3 && field.event !== 'stillwater' && rand() < (1 / 12);

    if (depth === 0) { field.grace = 'none'; genCrossingOne(); return; }  // the teaching field stays plain

    // guaranteed route northward, lanes 2-3 abreast (open water: wider DECOYS, sparser —
    // the route itself never widens: consecutive route stones stay well inside one hop)
    var wideK = field.biome.wide ? 1.25 : 1;
    var x = 0, routeXs = [];
    for (var y = 1; y < fieldH; y++) {
      // the fork freezes the route's drift across its span, so the split, the confluence
      // stone, and the resuming route all stay within one honest hop of each other
      if (!(field._forkRow && y > field._forkRow && y <= field._forkRow + 4))
        x = E.clamp(x + (rand() * 2 - 1) * 0.85, -2.6, 2.6);
      routeXs.push(x);
      stones.push(mkStone(x, y, holdP()));
      var n = (field.biome.wide ? 0 : 1) + Math.floor(rand() * 2);
      for (var k = 0; k < n; k++) {
        var sx = E.clamp(x + (rand() < 0.5 ? -1 : 1) * (0.9 + rand() * 1.3) * wideK, -3.6, 3.6);
        stones.push(mkStone(sx, y + (rand() * 0.5 - 0.25), holdP() * 0.94));
      }
    }
    // shore shallows — near-certain (arrival is quiet, not a jackpot)
    var endX = routeXs[routeXs.length - 1];
    for (var sh = -1; sh <= 1; sh++) stones.push(mkStone(E.clamp(endX + sh * 1.15, -3.2, 3.2), fieldH - 0.3, 0.97));

    // stranded lights: 1-2 stones OFF the efficient line — detours are chosen acts.
    // (rare event 'companions': two lights, early — a crossing made with others)
    var lights = field.event === 'companions' ? 2 : Math.min(3, 1 + Math.floor(depth / 2));
    var placed = 0, guard = 0;
    while (placed < lights && guard++ < 80) {
      var ySpanMax = field.event === 'companions' ? Math.floor(fieldH / 2) : (fieldH - 4);
      var yy = 2 + Math.floor(rand() * Math.max(2, ySpanMax));
      // the fork's pool stays visibly empty: lights reroll out of the split span
      if (field._forkRow && yy >= field._forkRow && yy <= field._forkRow + 4) continue;
      var rx = routeXs[Math.min(yy - 1, routeXs.length - 1)];
      var off = (rand() < 0.5 ? -1 : 1) * (1.2 + rand() * 0.9);
      // honest dice: a visible light marker must carry NO information about holding —
      // light stones roll the same odds as everything else
      var s = mkStone(E.clamp(rx + off, -3.6, 3.6), yy + rand() * 0.4, holdP(), { light: true });
      stones.push(s); placed++;
    }

    // the Lit Path (from crossing 2): parallels ~40% of the route, one gap aside.
    // consecutive causeway stones stay within one hop of each other — a road, not islands.
    // (rare event 'causeway': the golden road runs ~75% of the field — conformity's long test)
    // (rare event 'stillwater': NO golden road at all — when there is no certain road to
    //  refuse, the refusal must already live inside you)
    if (field.event !== 'stillwater') {
      var py0 = 2 + Math.floor(rand() * 2);
      var span = field.event === 'causeway'
        ? Math.min(fieldH - 4, Math.floor(fieldH * 0.75))
        : Math.max(4, Math.floor(fieldH * 0.4));
      var side = rand() < 0.5 ? -1 : 1;
      // a fork field keeps the gold road clear of the split span: shrink it to end before
      // the fork, else restart it beyond the confluence, else let this field go goldless
      // (the still water already made a road-less field a legal, meaningful state)
      if (field._forkRow && py0 + span >= field._forkRow) {
        if (field._forkRow - 1 - py0 >= 3) span = field._forkRow - 1 - py0;
        else if (Math.min(span, fieldH - 2 - (field._forkRow + 5)) >= 3) {
          py0 = field._forkRow + 5; span = Math.min(span, fieldH - 2 - py0);
        } else span = 0;
      }
      if (span >= 3) {
        var prevLx = null;
        for (var i = 0; i <= span; i++) {
          var ly = py0 + i;
          var lx = E.clamp(routeXs[Math.min(ly - 1, routeXs.length - 1)] + side * 1.35, -3.8, 3.8);
          if (prevLx !== null) lx = E.clamp(lx, prevLx - 0.85, prevLx + 0.85);
          prevLx = lx;
          var st = mkStone(lx, ly, 1, { lit: true, state: 'solid' });
          stones.push(st); litPath.push(stones.length - 1);
        }
        // exit shimmer stones ≤1 gap off the causeway edge, pulsing
        for (i = 1; i < litPath.length; i += 2) {
          var ls = stones[litPath[i]];
          stones.push(mkStone(E.clamp(ls.x - side * 1.0, -3.8, 3.8), ls.y + 0.2, Math.max(T.litExitP, holdP())));
        }
      }
    } else { field._stillBellAt = now + 3; }

    if (field.event === 'othertraveler') genTraveler(routeXs);
    deepeningPostPass(routeXs);
  }

  /* -------- the other traveler (rare event): another ember crosses, far off --------
   * Witness, not watcher: the line is fixed at generation, ≥3 gaps from the route for its
   * whole length; it never reacts to, approaches, or waits for the player. Strictly additive.
   * The agent starts well along its line, already receding — evidence, never a pace-setter.
   * Its stones are clampFade (the C1 mechanism): hesitation can drain but never drown them,
   * so the crossing can never step onto footing the player watched disappear. (ADR-029) */
  function genTraveler(routeXs) {
    var line = null, sgn0 = rand() < 0.5 ? -1 : 1, sgn;
    for (var attempt = 0; attempt < 2 && !line; attempt++) {
      sgn = attempt === 0 ? sgn0 : -sgn0;
      var xs = [], px2 = null, ok = true;
      for (var y = 2; y <= fieldH - 2; y++) {
        var rx2 = routeXs[Math.min(y - 1, routeXs.length - 1)];
        var tx2 = px2 === null ? rx2 + sgn * 3.2 : E.clamp(rx2 + sgn * 3.2, px2 - 0.4, px2 + 0.4);
        if (Math.abs(tx2 - rx2) < 3.0 || (px2 === null && Math.abs(tx2) < 3.0)) { ok = false; break; }
        xs.push(tx2); px2 = tx2;
      }
      if (ok) line = xs;
    }
    if (!line) { field.event = 'island'; return; }   // the marsh offers sanctuary instead
    var idxs = [], i2, ts2;
    for (i2 = 0; i2 < line.length; i2++) {
      ts2 = mkStone(line[i2], 2 + i2, holdP(), { clampFade: true });   // honest dice, undrownable
      ts2.trav = true;
      stones.push(ts2); idxs.push(stones.length - 1);
    }
    var startI = Math.floor(idxs.length * 0.4);
    for (i2 = 0; i2 <= startI; i2++) stones[idxs[i2]].state = 'solid'; // the road already behind it
    if (E.Motion.reduced) {
      // static form: the whole crossing already happened — same meaning, zero motion
      for (i2 = 0; i2 < idxs.length; i2++) stones[idxs[i2]].state = 'solid';
      var le = stones[idxs[idxs.length - 1]];
      lamps.push({ x: le.x, y: le.y, r: 1 });
    } else {
      var s0 = stones[idxs[startI]];
      field._traveler = { line: idxs, i: startI, x: s0.x, y: s0.y, from: null,
                          hopT: 0, hopping: false, nextHopAt: now + 2.5, depart: 0 };
    }
  }

  /* -------- deepening post-passes (one per field; route is never touched) -------- */
  function deepeningPostPass(routeXs) {
    var i;
    if (field.deepening === 'twins') {
      // two mid rows gain an identical twin beside the route stone — the same doubt, doubled:
      // two stones that look exactly alike, and looking still tells you nothing
      var twinRows = [Math.floor(fieldH * 0.4), Math.floor(fieldH * 0.65)];
      for (i = 0; i < twinRows.length; i++) {
        var tr = twinRows[i], trx = routeXs[Math.min(tr - 1, routeXs.length - 1)];
        stones.push(mkStone(E.clamp(trx + (rand() < 0.5 ? -0.62 : 0.62), -3.7, 3.7), tr + 0.05, holdP() * 0.9));
      }
    } else if (field.deepening === 'narrows') {
      // one mid row keeps ONLY its route stone: the single way forward is one uncertain stone
      var nr = Math.floor(fieldH * 0.55);
      stones = stones.filter(function (s) {
        if (s.lit || s.light || s.script || s.state === 'solid') return true;
        if (Math.abs(s.y - nr) > 0.55) return true;
        return Math.abs(s.x - routeXs[Math.min(nr - 1, routeXs.length - 1)]) < 0.3; // the route stone stays
      });
    } else if (field.deepening === 'drift') {
      // a few DECOY ghosts drift slowly on the water (≤0.09 gap/s) — footing that wanders.
      // Never route stones, never lights, never the causeway: traversability is sacred —
      // and the code enforces it, not just this comment (route membership checked below).
      var tagged = 0;
      for (i = 0; i < stones.length && tagged < 4; i++) {
        var ds = stones[i];
        if (ds.lit || ds.light || ds.script || ds.state !== 'ghost') continue;
        var routeX = routeXs[Math.min(Math.max(0, Math.round(ds.y) - 1), routeXs.length - 1)];
        if (Math.abs(ds.x - routeX) < 0.35) continue;   // the guaranteed route never drifts
        if (rand() < 0.3) { ds.drift = { base: ds.x, amp: 0.28 + rand() * 0.1, spd: 0.18 + rand() * 0.12, ph: rand() * E.TAU }; tagged++; }
      }
    } else if (field.deepening === 'latestones') {
      // one span of 2 rows whose OFF-route stones surface only after you commit to the row
      // before the span — the row looked emptier than it was; commitment reveals ground that
      // watching never shows. Strictly additive: the route itself is present from the start.
      var r0 = Math.floor(fieldH * 0.5);
      field._lateTrigger = r0 - 1; field._lateFired = false;
      for (i = 0; i < stones.length; i++) {
        var lsn = stones[i];
        if (lsn.lit || lsn.light || lsn.script || lsn.state !== 'ghost') continue;
        if (lsn.y >= r0 - 0.4 && lsn.y <= r0 + 1.6) {
          var isRoute = Math.abs(lsn.x - routeXs[Math.min(Math.round(lsn.y) - 1, routeXs.length - 1)]) < 0.3;
          if (!isRoute) { lsn.late = true; lsn.bornAt = Infinity; }
        }
      }
    } else if (field.deepening === 'rememberdoubt') {
      // some stones, once held, keep their broken mirror — the doubt is carried, not cured.
      // Invisible before weight (no information leak); mechanically identical to solid after.
      var dd = 0;
      for (i = 0; i < stones.length && dd < 4; i++) {
        var rs = stones[i];
        if (rs.lit || rs.light || rs.script || rs.state !== 'ghost' || rs.y > fieldH - 1) continue;
        if (rand() < 0.15) { rs.deepDoubt = true; dd++; }
      }
    } else if (field.deepening === 'fork') {
      // comparison doubt: the route splits around a dark pool. Both branches roll IDENTICAL
      // holdP() — the honest-dice law holds exactly; they differ only in costume (the short
      // branch rides lower and carries one extra mirror sliver, and that says NOTHING about
      // the dice — ride-height never correlates with p anywhere in this game; hesitated and
      // sunk stones ride lower for STATE reasons, never dice reasons). Choosing is the only
      // resolution; the confluence forgives the choice. Geometry (all hops ≤1.4 < reach
      // 1.58, recomputed independently in review — ADR-029): entry 1.39; A 1.0/1.06;
      // B 0.75/0.75/0.83; exits 1.17/1.01; confluence→resumed route 0.5.
      var yF = field._forkRow, aX = routeXs[yF - 1];
      stones = stones.filter(function (fs2) {
        if (fs2.lit || fs2.light || fs2.script || fs2.state !== 'ghost') return true;
        return !(fs2.y > yF + 0.35 && fs2.y < yF + 3.4);   // the split: the route IS the fork now
      });
      var FA = [[aX - 1.2, yF + 0.7], [aX - 1.2, yF + 1.7], [aX - 0.85, yF + 2.7]];
      var FB = [[aX + 1.2, yF + 0.7], [aX + 1.2, yF + 1.45], [aX + 1.2, yF + 2.2], [aX + 0.85, yF + 2.95]];
      for (i = 0; i < FA.length; i++) { var fa = mkStone(FA[i][0], FA[i][1], holdP()); fa.fork = true; fa.forkLow = true; stones.push(fa); }
      for (i = 0; i < FB.length; i++) { var fb = mkStone(FB[i][0], FB[i][1], holdP()); fb.fork = true; stones.push(fb); }
      // the rejoin point is born solid — it can never sink or be hesitated away
      var conf = mkStone(aX, yF + 3.5, 1, { state: 'solid' });
      conf.confluence = true; stones.push(conf);
      field._forkDone = false;
    }

    /* rare event 'island': a small mid-field sanctuary — solid ground, timerless, a rest
     * that must be LEFT again (the second departure is the braver one) */
    if (field.event === 'island') {
      var iy = Math.floor(fieldH * 0.5);
      var ix = routeXs[Math.min(iy - 1, routeXs.length - 1)];
      for (i = -1; i <= 1; i++) {
        var isl = mkStone(E.clamp(ix + i * 0.75, -3.5, 3.5), iy + Math.abs(i) * 0.12, 1, { state: 'solid' });
        isl.island = true;
        stones.push(isl);
      }
    }
  }

  /* Crossing 1 — the authored corridor. The dice are hidden; the first lessons are never
   * left to luck. (Council, 4 seats converged.) */
  function genCrossingOne() {
    fieldH = T.rows;
    var xs = [0, -0.4, 0.3, 0, -0.5, 0.2, -0.2, 0.4, -0.1, 0.3, -0.3, 0];
    var route = [];
    for (var i = 0; i < 11; i++) {
      var y = 1 + i * ((fieldH - 1.4) / 11);
      route.push({ x: xs[i], y: y });
    }
    // stones 1-3: solid ground — establish the verb three times
    for (i = 0; i < 3; i++) stones.push(mkStone(route[i].x, route[i].y, 1, { state: 'solid' }));
    // stone 4: the ONLY way forward is one doubtful stone, rigged to hold; can never fully drown
    stones.push(mkStone(route[3].x, route[3].y, 1, { script: 'hold', clampFade: true }));
    // stone 5: the fade lesson — a pair side by side, both rigged; hesitate and one drains
    stones.push(mkStone(route[4].x - 0.55, route[4].y, 1, { script: 'hold' }));
    stones.push(mkStone(route[4].x + 0.75, route[4].y, 1, { script: 'hold' }));
    // stone 6: the guaranteed kindle, ON the route — clamped so hesitation can never drown it
    stones.push(mkStone(route[5].x, route[5].y, 1, { script: 'hold', light: true, clampFade: true }));
    // stone 7: plain rigged hold
    stones.push(mkStone(route[6].x, route[6].y, 1, { script: 'hold' }));
    // stone 8: the SCRIPTED first sink — the ONLY stone reachable ahead, so every player
    // meets it. After the splash, the half-sunk stone itself is the recovery footing (the
    // lesson: a failed commitment becomes ground). A rigged side-stone is reachable only
    // from stone 8, never before it.
    stones.push(mkStone(route[7].x, route[7].y, 1, { script: 'sink' }));
    stones.push(mkStone(route[7].x - 1.2, route[7].y + 0.6, 1, { script: 'hold' }));
    // stones 9-11: true RNG begins, gently
    for (i = 8; i < 11; i++) stones.push(mkStone(route[i].x, route[i].y, 0.85));
    // shore shallows
    for (var sh = -1; sh <= 1; sh++) stones.push(mkStone(sh * 1.1, fieldH - 0.3, 0.97));
    scriptC1 = { sinkDone: false };
  }

  /* ============================= PLAYER ============================= */
  function resetPlayer() {
    player = {
      x: 0, y: 0, from: null, to: null, tHop: 0,
      state: 'idle',                     // idle | hop | splash
      glow: 0.85, leach: 0,              // leach = Lit Path color drain 0..1
      lastSolid: { x: 0, y: 0 },
      recover: 0,                        // splash glow-recovery credit
      steps: 0
    };
    onShore = true;
  }

  function reachable(s) {
    if (s.state === 'drowned') return false;
    if (s.bornAt && now < s.bornAt) return false;     // still forming — invisible, untargetable
    return E.dist(player.x, player.y, s.x, s.y) <= T.reach + 0.08;
  }

  function stepTo(s) {
    if (!s || player.state !== 'idle' || arriving) return false;
    if (!reachable(s)) { invalid(); return false; }
    player.state = 'hop';
    player.from = { x: player.x, y: player.y };
    player.to = s; player.tHop = 0;
    lastDir = { x: s.x - player.x, y: s.y - player.y };
    var m = Math.hypot(lastDir.x, lastDir.y) || 1; lastDir.x /= m; lastDir.y /= m;
    lastStepAt = now;
    firstStepEver = true;
    onShore = false;
    drownsThisSpell = 0;
    // apathy pushback fires at WEIGHT-COMMIT, before resolution — the act counts
    sleep = Math.max(0, sleep - 0.4); sleeping = false;
    E.Audio.heart();
    return true;
  }

  function resolveHold(s) {
    // p(hold) is independent of everything rendered. Scripts author the first lessons;
    // invariants keep the marsh humane: never two consecutive sinks; max 3 per crossing.
    if (s.lit || s.state === 'solid' || s.state === 'sunkPerm') return true;
    if (s.script === 'hold') return true;
    if (s.script === 'sink' && scriptC1 && !scriptC1.sinkDone) { scriptC1.sinkDone = true; return false; }
    if (lastWasSink) return true;
    if (sinksThisCrossing >= T.maxSinks) return true;
    // the first-ever step OFF the certain road — the game's single bravest input — is
    // never punished by dice. player.aboard still holds the state at the hop's start.
    if (!firstLitExitDone && player.aboard && !s.lit) { firstLitExitDone = true; return true; }
    return rand() < s.p;
  }

  function landOn(s) {
    var drift = !!s._isDriftTarget; s._isDriftTarget = false;
    player.x = s.x; player.y = s.y;
    if (!drift) player.steps++;
    if (resolveHold(s)) {
      if (s.state !== 'solid' && s.state !== 'sunkPerm') s.state = 'solid';
      player.lastSolid = { x: s.x, y: s.y };
      player.aboard = !!s.lit;                 // standing on the certain road?
      lastWasSink = false;
      s.hes = 0;                               // weight resolves the doubt; the mirror snaps clean
      s.drift = null;                          // ground you stand on stops wandering
      if (s.island) onShore = true;            // the island is a true sanctuary — until you step off
      if (drift) return;                       // a carry earns nothing: no sound, no kindle, no credit
      // latestones: committing to the row before the span surfaces the hidden footing
      if (field.deepening === 'latestones' && !field._lateFired && s.y >= field._lateTrigger - 0.5) {
        field._lateFired = true;
        var lk = 0;
        for (var li2 = 0; li2 < stones.length; li2++) {
          if (stones[li2].late) { stones[li2].bornAt = now + 1.2 + (lk++) * 0.2; }
        }
        if (lk) E.Audio.kindle(2);             // the surfacing tick — arrival music for the ground
      }
      if (s.deepDoubt && !s.keepBroken) {
        // held — and the mirror stays broken: commitment in spite of doubt, kept.
        // The clean snap is shown for a moment (the weight IS answered), then the doubt returns.
        s.keepBroken = true; s.cleanUntil = now + 0.6;
        player.glow = Math.min(1, player.glow + 0.05);
        E.Audio.holdDeep();
      } else E.Audio.hold();
      // the answered bell: if this commitment landed within a breath of the far bell, the
      // north answers — once, unfarmable, only ever for a doubted stone (never the certain
      // road, never a carry): the answer only comes to someone who moved anyway
      if (field._bellArmed && !s.lit && lastBellAt > 0 && now - lastBellAt <= 1.5) {
        field._bellArmed = false;
        E.Audio.bellAnswer();
      }
      // the confluence: landing the rejoin stone settles every fork stone still doubtful —
      // unconditional and branch-symmetric, so it can never say "you chose wrong"; it says
      // the same thing every time: the road not taken was also real. Drowned stones stay
      // drowned (hesitation's cost is not unsaid). Staggered nearest-first, an answer to
      // arrival, not a simultaneous unlock.
      if (s.confluence && field._forkDone === false) {
        field._forkDone = true;
        var fsettle = [];
        for (var fi = 0; fi < stones.length; fi++) {
          if (stones[fi].fork && stones[fi].state === 'ghost') fsettle.push(stones[fi]);
        }
        fsettle.sort(function (p2, q2) {
          return E.dist(p2.x, p2.y, s.x, s.y) - E.dist(q2.x, q2.y, s.x, s.y);
        });
        for (fi = 0; fi < fsettle.length; fi++) {
          fsettle[fi].state = 'solid'; fsettle[fi].hes = 0;
          fsettle[fi].confSettle = now + 0.4 + fi * 0.2;
        }
        if (fsettle.length) E.Audio.confluence();
      }
      if (field.grace === 'stirlight' && now - lastStir > 1.2) {
        lastStir = now;
        for (var sp = 0; sp < 5; sp++) {
          var sa = Math.random() * E.TAU, sr = 8 + Math.random() * 8;
          stirs.push({ x: s.x, y: s.y, ox: Math.cos(sa) * sr, oy: Math.sin(sa) * sr * 0.5, born: now });
        }
        if (stirs.length > 30) stirs.splice(0, stirs.length - 30);
      }
      if (s.light && !s.lightKindled) kindle(s);
      kindleNear();
      companionFollow();
      if (s.y >= fieldH - 0.6) arrive();
    } else {
      // the splash: dignified, net-non-negative. The stone remains, half-sunk, stable —
      // a failed commitment literally becomes footing.
      s.state = 'sunkPerm';
      sinksThisCrossing++; lastWasSink = true;
      player.state = 'splash'; player.tHop = 0;
      player.glow = Math.max(0.25, player.glow - T.splashGlowCost);
      player.recover = T.splashRecoverS;
      E.Audio.sink();
    }
  }

  function kindle(s) {
    s.lightKindled = true; kindledThisCrossing++;
    E.Audio.kindle(kindledThisCrossing);
    player.glow = Math.min(1, player.glow + 0.1);
    if (!companion) {
      companion = { x: s.x, y: s.y, born: player.steps, waiting: false, settleAt: T.companionSettleMin + Math.floor(rand() * (T.companionSettleMax - T.companionSettleMin)) };
    } else {
      lamps.push({ x: s.x, y: s.y, r: 1 });   // no room in the walk — it becomes a lamp at once
    }
  }
  function kindleNear() {
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.light && !s.lightKindled && E.dist(player.x, player.y, s.x, s.y) <= T.kindleRadius) kindle(s);
    }
  }
  function companionFollow() {
    if (!companion || companion.waiting) return;
    // settles after a while: 60% becomes a lamp on this stone; 40% departs into the fog
    if (player.steps - companion.born >= companion.settleAt) {
      if (rand() < 0.6) lamps.push({ x: companion.x, y: companion.y, r: 1 });
      else lamps.push({ x: companion.x, y: companion.y, r: 1, departing: now });
      companion = null;
    }
  }

  function invalid() {
    // one universal answer to every wrong input: a hop-in-place and the reachable stones pulse
    invalidPulse = 0.15;
    if (player.state === 'idle') { player.state = 'hop'; player.from = { x: player.x, y: player.y }; player.to = { x: player.x, y: player.y, _self: true }; player.tHop = T.hopMs * 0.55; }
  }

  function arrive() {
    arriving = true; arriveT = 0; crossings++;
    // a walking companion settles at the shore — its crossing completes with yours
    if (companion) { lamps.push({ x: companion.x, y: companion.y, r: 1 }); companion = null; }
    // the wordless bridge: after the FIRST crossing only, the About link glints ember a few
    // times (0.5 Hz, photosafe) — the poem offers its words exactly once, and never insists
    if (crossings === 1) {
      var ab = document.querySelector('.mast__nav a[href="about.html"]');
      if (ab) { ab.classList.add('glint'); setTimeout(function () { ab.classList.remove('glint'); }, 6500); }
    }
    E.Audio.shore();
  }

  /* ============================= UPDATE ============================= */
  function sleepGrace() {
    if (depth === 0) return T.sleepGraceC1;
    return depth < 3 ? T.sleepGrace : T.sleepGraceLate;
  }

  function update(dt) {
    now += dt;
    var idle = now - lastStepAt;

    /* apathy — the world falls asleep; tending freezes the ramp; shores are sanctuaries */
    var kindleSlow = 1 + 0.25 * Math.min(3, lamps.length + (companion ? 1 : 0));
    if (firstStepEver && !onShore && !arriving && player.state === 'idle' && !tending) {
      if (idle > sleepGrace()) sleep = Math.min(1, sleep + (T.sleepDesatPerS / kindleSlow) * dt);
    } else if (!tending) {
      sleep = Math.max(0, sleep - dt * 0.4);
    }
    // tending freezes the ramp — it never retreats it; endurance holds the line
    sleep = E.clamp(sleep, 0, 1);
    sleeping = sleep > 0.985;
    if (sleeping !== wasSleeping) {
      forceDraw = true;                        // a cadence transition is never seen mid-step
      if (sleeping) E.Audio.grey();            // the world going under: one low hush
      wasSleeping = sleeping;
    }
    if (!firstStepEver) attract += dt;

    /* hesitation — the adjacent candidate drains while you stand still; moving reverses it.
     * Gated exactly like the sleep ramp: never on shores (sanctuaries), never during arrival,
     * and TENDING freezes it (chosen presence is not dithering — neither accrual nor reversal). */
    var cand = hesitationTarget();
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      s.pulseT = Math.max(0, s.pulseT - dt);
      // drifting footing (deepening): decoy ghosts wander slowly; still under reduced motion
      if (s.drift && s.state === 'ghost') {
        s.x = s.drift.base + Math.sin(E.Motion.reduced ? s.drift.ph : (now * s.drift.spd + s.drift.ph)) * s.drift.amp;
      }
      if (s.state === 'ghost') {
        if (tending) continue;                                   // the line holds; nothing moves
        if (s === cand && player.state === 'idle' && idle > T.hesOnset && firstStepEver &&
            !onShore && !arriving && drownsThisSpell < 2) {
          s.hes = Math.min(T.hesFull, s.hes + dt);
          if (s.hes >= T.hesFull && !s.clampFade) {
            s.state = 'drowned'; s.tDrown = now; drownsThisSpell++; nucleate(s);
          }
        } else {
          s.hes = Math.max(0, s.hes - dt * T.hesReverse);
        }
      }
    }

    /* player motion */
    if (player.state === 'hop') {
      player.tHop += dt * 1000;
      var t = Math.min(1, player.tHop / T.hopMs);
      var e2 = E.smoothstep(t);
      if (!player.to._self) {
        player.x = E.lerp(player.from.x, player.to.x, e2);
        player.y = E.lerp(player.from.y, player.to.y, e2);
      }
      if (t >= 1) { var s2 = player.to; player.state = 'idle'; if (!s2._self) landOn(s2); }
    } else if (player.state === 'splash') {
      player.tHop += dt * 1000;
      var t3 = Math.min(1, player.tHop / T.splashMs);
      player.x = E.lerp(player.x, player.lastSolid.x, t3 * 0.16);
      player.y = E.lerp(player.y, player.lastSolid.y, t3 * 0.16);
      if (t3 >= 1) { player.x = player.lastSolid.x; player.y = player.lastSolid.y; player.state = 'idle'; }
    }
    // splash recovery: ~8s of onward stepping in wall time (not just mid-hop frames)
    if (player.recover > 0 && (now - lastStepAt) < 2.2 && player.state !== 'splash') {
      player.recover -= dt;
      player.glow = Math.min(1, player.glow + (T.splashGlowCost / T.splashRecoverS) * dt);
    }

    /* the Lit Path: honest gifts, slow leach, deniable drift; companion refuses and waits.
     * "aboard" is where your last weight landed — the timers survive the drift's own hops. */
    if (player.aboard) {
      player.leach = Math.min(1, player.leach + T.litLeachPerS * dt);
      if (companion) companion.waiting = true;
      // the drift only counts STANDING time — walking the road forward is honest progress
      if (player.state === 'idle') {
        player._aboardT = (player._aboardT || 0) + dt;
      }
      var a = player._aboardT || 0;
      var rate = a < T.litDriftRamp[0] ? 0 : a < T.litDriftRamp[2] ? T.litDriftRamp[1] : T.litDriftRamp[3];
      if (player.state === 'idle') player._driftAcc = (player._driftAcc || 0) + rate * dt;
      if (player._driftAcc >= 1 && player.state === 'idle') {
        player._driftAcc = 0;
        var li = litIndexAt(player.lastSolid.x, player.lastSolid.y);
        if (li > 0) {
          var b = stones[litPath[li - 1]];
          if (E.Motion.reduced) { // discrete reposition, same meaning
            player.x = b.x; player.y = b.y; player.lastSolid = { x: b.x, y: b.y };
          } else {
            // a forced carry, not a commitment: no heartbeat, no credit anywhere
            player.state = 'hop';
            player.from = { x: player.x, y: player.y };
            b._isDriftTarget = true;
            player.to = b; player.tHop = 0;
          }
        }
      }
      sleep = Math.max(0, sleep - dt);        // sleep-immune aboard (an honest gift)
    } else {
      player._aboardT = 0; player._driftAcc = 0;
      player.leach = Math.max(0, player.leach - dt / 20);
      if (companion && companion.waiting) companion.waiting = false;
    }

    /* companion walks a step behind (or waits at the causeway edge, flame steady) */
    if (companion && !companion.waiting) {
      companion.x = E.lerp(companion.x, player.lastSolid.x, Math.min(1, dt * 2));
      companion.y = E.lerp(companion.y, player.lastSolid.y - 0.55, Math.min(1, dt * 2));
    }

    /* the other traveler crosses its own line — fixed at generation, indifferent to you */
    if (field._traveler) updateTraveler(dt);

    /* arrival → sanctuary breath → next field */
    if (arriving) {
      arriveT += dt;
      if (arriveT > 2.8) {
        depth++; arriving = false;
        genField(); resetPlayer();
        sleep = 0; lastStepAt = now;
        hoverStone = null; lastDir = { x: 0, y: 1 };   // never carry a phantom into the new field
        drownsThisSpell = 0;
      }
    }

    var k = E.Motion.reduced ? 1 : Math.min(1, T.camLerp * dt * 60);
    cam.x = E.lerp(cam.x, player.x, k);
    cam.y = E.lerp(cam.y, player.y + 1.35, k);
  }

  function updateTraveler(dt) {
    var tv = field._traveler;
    if (E.Motion.reduced) {
      // a live reduced-motion toggle converges to the static form in one frame:
      // the crossing already happened — settle the line, leave the lamp, no agent
      for (var ri = 0; ri < tv.line.length; ri++) {
        var rs2 = stones[tv.line[ri]];
        if (rs2.state === 'ghost') { rs2.state = 'solid'; rs2.hes = 0; }
      }
      var rl = stones[tv.line[tv.line.length - 1]];
      if (!tv.depart) lamps.push({ x: rl.x, y: rl.y, r: 1 });
      field._traveler = null;
      return;
    }
    if (tv.depart) {
      if (now - tv.depart >= 12) field._traveler = null;   // the halo has gone its way
      return;
    }
    if (tv.hopping) {
      tv.hopT += dt;
      var tk = E.smoothstep(Math.min(1, tv.hopT / 0.34));
      var t2 = stones[tv.line[tv.i + 1]];
      tv.x = E.lerp(tv.from.x, t2.x, tk); tv.y = E.lerp(tv.from.y, t2.y, tk);
      if (tv.hopT >= 0.34) {
        tv.hopping = false; tv.i++;
        if (t2.state === 'ghost') t2.state = 'solid';      // its weight, its resolution
        t2.hes = 0;
        if (tv.i >= tv.line.length - 1) {
          lamps.push({ x: t2.x, y: t2.y, r: 1 });          // the lamp is PERMANENT — what its
          tv.depart = now;                                 // courage built keeps existing; only
        } else tv.nextHopAt = now + 2.0;                   // the being departs, by its own nature
      }
    } else if (now >= tv.nextHopAt && tv.i < tv.line.length - 1) {
      tv.hopping = true; tv.hopT = 0; tv.from = { x: tv.x, y: tv.y };
      // its heartbeat carries only when near — witness, not soundtrack
      if (E.dist(tv.x, tv.y, player.x, player.y) <= 4.5) E.Audio.heartQuiet();
    }
  }

  function hesitationTarget() {
    if (hoverStone && hoverStone.state === 'ghost' && reachable(hoverStone)) return hoverStone;
    // facing-direction candidate: nearest reachable ghost roughly the way Rollo last moved
    var best = null, bs = -1e9;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.state !== 'ghost' || !reachable(s)) continue;
      var vx = s.x - player.x, vy = s.y - player.y, d = Math.hypot(vx, vy) || 1;
      var dot = (vx * lastDir.x + vy * lastDir.y) / d;
      if (dot < 0.3) continue;
      var sc = dot - d * 0.3;
      if (sc > bs) { bs = sc; best = s; }
    }
    return best;
  }
  function nucleate(s) {
    // hesitation costs THAT option, never possibility: a replacement forms nearby —
    // ALWAYS within the player's reach (a lost option must never become a dead end),
    // and it inherits a stranded light so a kindle can never be drowned away.
    var a = (rand() - 0.5) * Math.PI;                       // forward-biased half-circle
    var r2 = 0.7 + rand() * 0.5;                            // 0.7-1.2 gaps from the player
    var nx = E.clamp(player.x + Math.sin(a) * r2, -3.8, 3.8);
    var ny = E.clamp(player.y + Math.cos(a) * r2 * 0.9 + 0.3, 0.8, fieldH - 0.4);
    var ns = mkStone(nx, ny, Math.max(s.p, holdP()), { light: s.light && !s.lightKindled });
    ns.bornAt = now + T.nucleateS;
    stones.push(ns);
  }
  function litIndexAt(x, y) {
    for (var i = 0; i < litPath.length; i++) {
      var s = stones[litPath[i]];
      if (Math.abs(s.x - x) < 0.05 && Math.abs(s.y - y) < 0.05) return i;
    }
    return -1;
  }
  function currentLitIndex() { return litIndexAt(player.x, player.y); }

  /* ============================= RENDER ============================= */
  function wx(x) { return W / 2 + (x - cam.x) * T.unit; }
  function wy(y) { return H * 0.60 - (y - cam.y) * T.unit; }
  function desat(hex, k) { return E.mix(hex, C.grey, k); }

  function draw() {
    if (!W || !H) return;
    var RM = E.Motion.reduced;
    var slp = RM ? Math.round(sleep * 3) / 3 : sleep;   // discrete steps under reduced motion
    var worldDesat = slp * (1 - T.sleepFloor);

    /* water + horizon band (top 22%) + a constant warm far band — forwardness without a goal.
     * The biome tints the register; the fog itself never lifts. */
    var B = field.biome;
    X.fillStyle = desat(B.water, worldDesat); X.fillRect(0, 0, W, H);
    var hb = X.createLinearGradient(0, 0, 0, H * 0.30);
    hb.addColorStop(0, desat(B.horizon, worldDesat));
    hb.addColorStop(0.6, desat(B.warm, worldDesat));
    hb.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = hb; X.fillRect(0, 0, W, H * 0.30);

    /* motes drifting shoreward (never under reduced motion) */
    if (!RM) {
      X.globalAlpha = 0.05;
      X.fillStyle = C.bone;
      for (var i = 0; i < 22; i++) {
        var mxx = ((i * 131.7) % W + Math.sin(i) * 30 + W) % W;
        var myy = ((i * 73.3) - now * (8 + (i % 5)) % H + H * 4) % H;
        X.fillRect(mxx, myy, 1.4, 1.4);
      }
      X.globalAlpha = 1;
    }

    /* biome texture: reeds at the margins; night rain's thin drizzle */
    drawBiome(RM, worldDesat);

    /* grace — this field's one extra kindness */
    drawGrace(RM, worldDesat);

    drawShore(0, true, worldDesat); drawShore(fieldH, false, worldDesat);

    var px = wx(player.x), py = wy(player.y);
    var vGeom = field.fogGeom * T.unit, vGlow = T.fogGlow * T.unit;

    /* lamps you left — their halos carry through the fog behind you */
    for (i = 0; i < lamps.length; i++) drawLamp(lamps[i], px, py, vGlow, RM, worldDesat);

    /* stones */
    for (i = 0; i < stones.length; i++) drawStone(stones[i], px, py, vGeom, RM, worldDesat);

    /* act-answer light + the moths at your lamps */
    drawStirs(RM, worldDesat);
    drawMoths(RM, worldDesat);

    /* the companion */
    if (companion) drawCompanion(RM, worldDesat);

    /* the other traveler — a dim halo out in the fog, crossing anyway */
    if (field._traveler) drawTraveler(worldDesat);

    /* Rollo */
    drawEmber(px, py, RM, worldDesat, slp);

    /* lantern veil */
    var lg = X.createRadialGradient(px, py, 0, px, py, vGeom);
    lg.addColorStop(0, E.withAlpha(C.ember, 0.09 * (1 - worldDesat) * (1 - player.leach * 0.7)));
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = lg; X.beginPath(); X.arc(px, py, vGeom, 0, E.TAU); X.fill();

    /* arrival: one soft exhale — legible even with sound off — but the fog does NOT lift */
    if (arriving) {
      var a = Math.min(1, arriveT / 0.9) * (arriveT > 2.0 ? Math.max(0, 1 - (arriveT - 2.0) / 0.8) : 1);
      X.fillStyle = 'rgba(232,228,220,' + (0.09 * a) + ')';
      X.fillRect(0, 0, W, H);
    }
  }

  function drawBiome(RM, wd) {
    var B = field.biome;
    if (B.reeds) {
      // reeds at the field margins: slender strokes, swaying under 0.5 Hz (still under RM)
      X.save(); X.globalAlpha = 0.35 * (1 - wd * 0.5);
      X.strokeStyle = desat('#2c2a1e', wd); X.lineWidth = 1.6;
      for (var i = 0; i < 16; i++) {
        var side = i < 8 ? -1 : 1;
        var rxw = side * (3.4 + (i % 4) * 0.28);
        var ryw = 1 + (i * 1.63) % (fieldH - 2);
        var bx = wx(rxw), by = wy(ryw);
        if (bx < -30 || bx > W + 30 || by < -40 || by > H + 40) continue;
        var sway = RM ? 0 : Math.sin(now * 0.45 + i * 1.7) * 3;
        var hgt = 26 + (i % 3) * 9;
        X.beginPath(); X.moveTo(bx, by);
        X.quadraticCurveTo(bx + sway * 0.5, by - hgt * 0.6, bx + sway, by - hgt);
        X.stroke();
      }
      X.restore();
    }
    if (B.rainy && !RM) {
      // thin night drizzle: sparse slow streaks, low alpha — weather, not spectacle
      X.save(); X.globalAlpha = 0.06;
      X.strokeStyle = C.bone; X.lineWidth = 1;
      for (i = 0; i < 14; i++) {
        var dx2 = ((i * 149.3) % W), dy2 = ((i * 97.1 + now * 90) % (H + 40)) - 20;
        X.beginPath(); X.moveTo(dx2, dy2); X.lineTo(dx2 - 1.5, dy2 + 9); X.stroke();
      }
      X.restore();
    }
  }

  /* per-field deterministic pseudo-random for grace layouts (seeded, motion-free) */
  function fr(i) { var x = Math.sin(field.rseed * 0.0001 + i * 127.1) * 43758.5453; return x - Math.floor(x); }

  function drawGrace(RM, wd) {
    var grace = field.grace;
    if (!grace || grace === 'none' || grace === 'chord' || grace === 'owl' || grace === 'shorebirds') return;
    // reduced motion loses the movement, never the gift: every grace has a static form
    X.save();
    var i, t, fx, fy, fa;
    if (grace === 'rain') {
      X.strokeStyle = C.bone; X.lineWidth = 1;
      for (i = 0; i < 7; i++) {
        t = RM ? 0.55 : (now * 0.35 + i * 0.14) % 1;
        var rx = ((i * 197.3) % W), ry = ((i * 89.1) % (H * 0.7)) + H * 0.2;
        X.beginPath(); X.arc(rx, ry, t * 26, 0, E.TAU); X.globalAlpha = 0.10 * (1 - t); X.stroke();
      }
    } else if (grace === 'fireflies') {
      for (i = 0; i < 5; i++) {
        fx = RM ? W * (0.2 + 0.6 * fr(i)) : W * (0.15 + 0.7 * ((i * 0.23 + Math.sin(now * 0.11 + i * 2)) % 1));
        fy = RM ? H * (0.3 + 0.4 * fr(i + 9)) : H * (0.25 + 0.5 * ((i * 0.31 + Math.cos(now * 0.09 + i)) % 1));
        fa = RM ? 0.3 : 0.25 + 0.2 * Math.sin(now * 0.8 + i * 2.2);
        X.globalAlpha = Math.max(0, fa) * (1 - wd);
        X.fillStyle = C.gold; X.beginPath(); X.arc(fx, fy, 1.6, 0, E.TAU); X.fill();
      }
    } else if (grace === 'snow') {
      X.globalAlpha = 0.12;
      X.fillStyle = C.bone;
      for (i = 0; i < 16; i++) {
        var sx2 = RM ? fr(i) * W : ((i * 157.9 + now * 6) % W);
        var sy2 = RM ? fr(i + 20) * H : ((i * 91.7 + now * 14) % H);
        X.fillRect(sx2, sy2, 1.6, 1.6);
      }
    } else if (grace === 'aurora') {
      X.globalAlpha = 0.05 * (1 - wd);
      var ag = X.createLinearGradient(0, 0, W, 0);
      ag.addColorStop(0, 'rgba(0,0,0,0)'); ag.addColorStop(0.5, C.gold); ag.addColorStop(1, 'rgba(0,0,0,0)');
      X.fillStyle = ag; X.fillRect(0, H * 0.02, W, H * 0.10);
    } else if (grace === 'stars') {
      // a break in the overcast, overhead only — the water-level fog never thins
      X.fillStyle = C.bone;
      for (i = 0; i < 9; i++) {
        var stx = fr(i) * W, sty = H * (0.02 + 0.10 * fr(i + 30));
        var sz = 1 + fr(i + 60) * 0.7;
        var base = 0.05 + 0.06 * fr(i + 90);
        var tw = RM ? 1 : (0.75 + 0.25 * Math.sin(now * E.TAU / (11 + fr(i) * 8) + i));
        X.globalAlpha = base * tw * (1 - wd);
        X.fillRect(stx, sty, sz, sz);
      }
      // one held star with static hairline glints
      X.globalAlpha = 0.12 * (1 - wd);
      var hx = fr(99) * W * 0.8 + W * 0.1, hy = H * 0.05;
      X.fillRect(hx, hy, 2.2, 2.2);
      X.globalAlpha = 0.05; X.fillRect(hx - 5, hy + 0.7, 12, 0.8); X.fillRect(hx + 0.7, hy - 5, 0.8, 12);
    } else if (grace === 'moon') {
      // a veiled moon in the horizon band — light through the fog, never a lifting of it
      var mx = W * (0.30 + 0.40 * fr(3)), my = H * 0.13;
      var mr = RM ? 88 : 88 + 5 * Math.sin(now * E.TAU / 22);
      var mg = X.createRadialGradient(mx, my, 0, mx, my, mr);
      mg.addColorStop(0, E.withAlpha(C.bone, 0.10 * (1 - wd)));
      mg.addColorStop(0.35, E.withAlpha(C.bone, 0.035));
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      X.fillStyle = mg; X.beginPath(); X.arc(mx, my, mr, 0, E.TAU); X.fill();
      X.globalAlpha = 0.05;                       // the occluding wisp: it stays behind fog
      X.fillStyle = field.biome.horizon;
      X.beginPath(); X.ellipse(mx, my + 8, 65, 11, 0, 0, E.TAU); X.fill();
    } else if (grace === 'frogs') {
      // frog dimples near the field edges — small, non-looping, edge-anchored company
      var cyc = Math.floor(now / 10);
      t = RM ? 0.5 : (now % 10) / 1.2;
      if (t < 1) {
        var dxp = (cyc % 2 ? W * 0.9 : W * 0.1) + (fr(cyc) - 0.5) * 50;
        var dyp = H * (0.55 + 0.3 * fr(cyc + 7));
        X.globalAlpha = 0.08 * (1 - t);
        X.strokeStyle = C.bone; X.lineWidth = 1;
        X.beginPath(); X.arc(dxp, dyp, t * 14, 0, E.TAU); X.stroke();
      }
    }
    X.restore(); X.globalAlpha = 1;
  }

  /* stirred light: the water answers weight with light — after resolution only, never before */
  function drawStirs(RM, wd) {
    if (!stirs.length) return;
    X.save();
    for (var i = stirs.length - 1; i >= 0; i--) {
      var st = stirs[i];
      var t = (now - st.born) / 1.6;
      if (t >= 1) { stirs.splice(i, 1); continue; }
      var k = RM ? 1 : t;
      X.globalAlpha = 0.22 * (1 - t) * (1 - wd);
      X.fillStyle = '#9fd8c8';
      X.beginPath(); X.arc(wx(st.x) + st.ox * (0.6 + 0.4 * k), wy(st.y) + 6 + st.oy * (0.6 + 0.4 * k), 1.4, 0, E.TAU); X.fill();
    }
    X.restore(); X.globalAlpha = 1;
  }

  /* moths at your lamps: life comes only to the lights you made. Fixed cap — never an economy */
  function drawMoths(RM, wd) {
    if (field.grace !== 'moths' || !lamps.length) return;
    X.save();
    X.fillStyle = C.bone;
    var drawn = 0;
    for (var l = 0; l < lamps.length && drawn < 6; l++) {
      var lm = lamps[l];
      if (lm.departing) continue;
      var lx = wx(lm.x), ly = wy(lm.y) - 8;
      for (var j = 0; j < 2 && drawn < 6; j++, drawn++) {
        var mxo, myo;
        if (RM) { mxo = (j ? 9 : -7); myo = 4; }   // moths landed for the night
        else {
          mxo = Math.cos(now * E.TAU / 7.0 + j * 2.4 + l) * (10 + 4 * j);
          myo = Math.sin(now * E.TAU / 5.3 + j * 2.4 + l) * (7 + 3 * j);
        }
        X.globalAlpha = 0.14 * (1 - wd);
        X.fillRect(lx + mxo, ly + myo, 1.4, 1.4);
        X.fillRect(lx + mxo + 1.6, ly + myo, 1.4, 1.4);
      }
    }
    X.restore(); X.globalAlpha = 1;
  }

  function drawShore(yRow, south, wd) {
    var y0 = wy(yRow + (south ? -0.32 : 0.32));
    X.fillStyle = desat('#141210', wd);
    X.beginPath();
    if (south) X.rect(0, y0, W, H - y0 + 12); else X.rect(0, -12, W, y0 + 12);
    X.fill();
    X.strokeStyle = E.withAlpha(C.stoneDark, 0.7); X.lineWidth = 1;
    X.beginPath(); X.moveTo(0, y0); X.lineTo(W, y0); X.stroke();
  }

  function drawLamp(l, px, py, vGlow, RM, wd) {
    var lx = wx(l.x), ly = wy(l.y);
    var departK = 0;
    if (l.departing) {
      departK = Math.min(1, (now - l.departing) / 12);
      if (departK >= 1) return;                 // fully gone — draw nothing, touch nothing
      ly -= departK * 60;
    }
    var d = Math.hypot(lx - px, ly - py);
    if (d > vGlow + 60) return;
    X.save();
    var a = E.clamp(1.3 - d / vGlow, 0.12, 0.8) * (1 - wd * 0.5) * (1 - departK);
    var g2 = X.createRadialGradient(lx, ly - 8, 0, lx, ly - 8, 26);
    g2.addColorStop(0, E.withAlpha(C.ember, 0.45 * a)); g2.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = g2; X.beginPath(); X.arc(lx, ly - 8, 26, 0, E.TAU); X.fill();
    var fl = RM ? 0 : Math.sin(now * 1.3 + l.x * 7) * 0.6;
    X.fillStyle = desat(C.emberHot, wd * 0.4);
    X.globalAlpha = Math.min(1, a + 0.1);
    X.beginPath(); X.arc(lx, ly - 8, 2.6 + fl * 0.4, 0, E.TAU); X.fill();
    X.restore();
  }

  function drawStone(s, px, py, vGeom, RM, wd) {
    if (s.bornAt && now < s.bornAt) return;    // still nucleating
    var sx = wx(s.x), sy = wy(s.y);
    var d = Math.hypot(sx - px, sy - py);
    if (!s.lit && d > vGeom + T.unit * 0.7) return;
    var edge = s.lit ? 1 : E.clamp(1.3 - d / vGeom, 0, 1);
    if (edge <= 0.02) return;

    var hesK = s.hes > 0 ? E.clamp(s.hes / T.hesFull, 0, 1) : 0;
    if (s.clampFade) hesK = Math.min(hesK, 0.4);
    var doubtful = s.state === 'ghost';
    var drownK = s.state === 'drowned' ? 1 : hesK;

    // waterline bob: doubtful stones ride lower; hesitated ones sink further.
    // The fork's short branch rides lower still (0.26 vs 0.16 — under sunkPerm's 0.34, so it
    // never reads as a wreck): pure costume, zero dice correlation — both branches roll
    // identical holdP() by construction.
    var bob = 0;
    if (doubtful) {
      var wob = RM ? 0 : Math.sin(now * E.TAU * 0.4 + s.phase) * 1.6; // ≤0.5Hz, small
      bob = T.bob * T.unit * (s.forkLow ? 0.26 : 0.16) + wob + drownK * T.unit * 0.35;
    }
    if (s.state === 'sunkPerm') bob = T.bob * T.unit * 0.34;
    if (s.state === 'drowned') return;

    // confluence settle: a one-way 2s crossfade (live reduced-motion check — RM gets the
    // settled form instantly, matching the drift-stone convention)
    var ck = 1;
    if (s.confSettle) ck = RM ? 1 : E.clamp((now - s.confSettle) / 2, 0, 1);

    var body;
    if (s.lit) body = desat(C.gold, wd * 0.4);
    else if (s.island) body = desat('#1c1916', wd);            // sanctuary ground, like the shores
    else if (s.state === 'solid') body = (s.confSettle && ck < 1)
        ? desat(E.mix(C.stoneDim, C.stone, ck), wd)
        : desat(C.stone, wd);
    else if (s.state === 'sunkPerm') body = desat(C.stoneDark, wd);
    else body = desat(C.stoneDim, wd);   // same ghost body under reduced motion — the static
                                         // broken mirror carries the doubt; contrast stays ≥3:1
    // biome paling (winter frost, open-water cool): a tint, never an information channel —
    // it applies to whole states uniformly, so it can't leak odds
    if (!s.lit && field.biome.pale > 0) body = E.mix(body, C.bone, field.biome.pale);

    var alpha = s.lit ? 0.95
      : (s.state === 'solid' ? (s.confSettle ? E.lerp(0.85, 0.92, ck) : 0.92)
        : s.state === 'sunkPerm' ? 0.75 : 0.85) * edge;

    // invalid-input answer / attract: reachable stones pulse
    var pulse = 0;
    if ((invalidPulse > 0 || (!firstStepEver && Math.sin(now * 1.6) > 0.86)) && reachable(s) && s.state !== 'drowned') pulse = 0.2;

    X.save();
    X.globalAlpha = Math.min(1, alpha + pulse);
    X.fillStyle = body;
    X.beginPath();
    for (var i = 0; i < s.shape.length; i++) {
      var p = s.shape[i];
      var rx = sx + Math.cos(p.a) * p.r * T.unit;
      var ry = sy + bob + Math.sin(p.a) * p.r * T.unit * 0.55;
      if (i === 0) X.moveTo(rx, ry); else X.lineTo(rx, ry);
    }
    X.closePath(); X.fill();

    // the reflection carries the doubt: solid stones mirror cleanly; doubtful ones break
    var refY = sy + bob + T.unit * 0.34;
    X.globalAlpha = (s.lit ? 0.30 : 0.22) * edge * (1 - drownK);
    X.fillStyle = body;
    if (doubtful && !RM) {
      // broken, wavering reflection: displaced slivers (≤0.5Hz, ±2px);
      // the fork's short branch carries one extra sliver — costume, never information
      for (i = 0; i < (s.forkLow ? 4 : 3); i++) {
        var off = Math.sin(now * E.TAU * (0.3 + i * 0.08) + s.phase + i) * 2;
        X.fillRect(sx - T.unit * 0.22 + off, refY + i * 3.5, T.unit * 0.44, 2.1);
      }
    } else if (doubtful && RM) {
      // static broken mirror
      for (i = 0; i < (s.forkLow ? 4 : 3); i++) X.fillRect(sx - T.unit * 0.22 + (i % 2 ? 3 : -3), refY + i * 3.5, T.unit * 0.4, 2.1);
    } else if (s.state === 'solid' && s.confSettle && ck < 1) {
      // settling: the mirror stays broken until the fade completes — then, and only then,
      // the clean ellipse: the road not taken becoming real is watched, not popped
      for (i = 0; i < 3; i++) X.fillRect(sx - T.unit * 0.22 + (i % 2 ? 3 : -3), refY + i * 3.5, T.unit * 0.4, 2.1);
    } else if (s.state === 'solid' && s.keepBroken && now > (s.cleanUntil || 0)) {
      // remembered doubt: held, mechanically sound — and the mirror stays broken.
      // Commitment in spite of doubt, kept; certainty was never the reward.
      X.globalAlpha = 0.14 * edge;
      for (i = 0; i < 3; i++) X.fillRect(sx - T.unit * 0.22 + (i % 2 ? 3 : -3), refY + i * 3.5, T.unit * 0.4, 2.1);
    } else if (s.state === 'solid' || s.lit) {
      X.beginPath(); X.ellipse(sx, refY, T.unit * 0.26, T.unit * 0.09, 0, 0, E.TAU); X.fill();
    }

    if (s.lit) {
      X.globalAlpha = 0.25 * (1 - wd * 0.5);
      var gg = X.createRadialGradient(sx, sy, 0, sx, sy, T.unit * 0.95);
      gg.addColorStop(0, E.withAlpha(C.gold, 0.5)); gg.addColorStop(1, 'rgba(0,0,0,0)');
      X.fillStyle = gg; X.beginPath(); X.arc(sx, sy, T.unit * 0.95, 0, E.TAU); X.fill();
      // motionless pale lanterns of the causeway
      X.globalAlpha = 0.65; X.fillStyle = desat(C.grey, wd * 0.3);
      X.beginPath(); X.arc(sx, sy - 12, 3, 0, E.TAU); X.fill();
      X.globalAlpha = 0.35; X.fillStyle = C.gold;
      X.beginPath(); X.arc(sx, sy - 12, 5.5, 0, E.TAU); X.fill();
    }
    if (s.light && !s.lightKindled) {
      var pu = RM ? 0 : Math.sin(now * 1.0 + s.phase) * 1.1;
      X.globalAlpha = 0.75 * Math.max(0.4, edge);
      X.fillStyle = E.withAlpha(C.bone, 0.6);
      X.beginPath(); X.arc(sx, sy + (doubtful ? bob : 0) - 10, 3 + pu * 0.4, 0, E.TAU); X.fill();
    }
    X.restore();
  }

  function drawTraveler(wd) {
    // one dim ember halo at 0.5 hops/s — dimmer than the companion, never approaching.
    // (Reduced motion never reaches here: the agent converges to its static form in update.)
    var tv = field._traveler;
    var dk = tv.depart ? Math.min(1, (now - tv.depart) / 12) : 0;
    if (dk >= 1) return;
    var lift = tv.hopping ? Math.sin(Math.min(1, tv.hopT / 0.34) * Math.PI) * 8 : 0;
    var tx2 = wx(tv.x), ty2 = wy(tv.y) - 8 - lift - dk * 60;
    var a = 0.35 * (1 - wd * 0.4) * (1 - dk);
    var g2 = X.createRadialGradient(tx2, ty2, 0, tx2, ty2, 22);
    g2.addColorStop(0, E.withAlpha(C.ember, a)); g2.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = g2; X.beginPath(); X.arc(tx2, ty2, 22, 0, E.TAU); X.fill();
    X.globalAlpha = Math.min(1, a + 0.2);
    X.fillStyle = C.emberHot;
    X.beginPath(); X.arc(tx2, ty2, 2.2, 0, E.TAU); X.fill();
    X.globalAlpha = 1;
  }

  function drawCompanion(RM, wd) {
    var fx = wx(companion.x), fy = wy(companion.y) - 8;
    var breathe = RM ? 0 : Math.sin(now * 1.1) * 0.8;
    // waiting at the causeway edge: flame held STEADY — desire, not a guilt-timer
    var r = companion.waiting ? 2.8 : 2.8 + breathe * 0.4;
    var g2 = X.createRadialGradient(fx, fy, 0, fx, fy, 22);
    g2.addColorStop(0, E.withAlpha(C.ember, 0.5 * (1 - wd * 0.4))); g2.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = g2; X.beginPath(); X.arc(fx, fy, 22, 0, E.TAU); X.fill();
    X.fillStyle = desat(C.emberHot, wd * 0.3);
    X.beginPath(); X.arc(fx, fy, r, 0, E.TAU); X.fill();
  }

  function drawEmber(px, py, RM, wd, slp) {
    var hop = player.state === 'hop' && !player.to._self ? Math.sin(Math.min(1, player.tHop / T.hopMs) * Math.PI) : 0;
    var dip = player.state === 'splash' ? Math.sin(Math.min(1, player.tHop / T.splashMs) * Math.PI) * 6 : 0;
    var lift = hop * 15 - dip;
    var conform = Math.max(player.leach, 0);
    var pilot = T.sleepFloor;
    var bright = Math.max(pilot, player.glow * (1 - slp * (1 - pilot)));
    var core = E.mix(C.emberHot, C.grey, conform);
    var mid = E.mix(C.ember, C.grey, conform);
    var breathHz = sleeping ? 0.2 : 0.5;
    var amp = tending ? 1.2 : 1;
    var flick = RM ? 0 : (Math.sin(now * E.TAU * breathHz) * 0.8 + Math.sin(now * 3.4) * 0.3) * amp;
    var r = (6.5 + flick) * (0.7 + 0.5 * bright);

    var gl = X.createRadialGradient(px, py - 10 - lift, 0, px, py - 10 - lift, r * 5);
    gl.addColorStop(0, E.withAlpha(C.ember, 0.5 * bright * (1 - conform * 0.5)));
    gl.addColorStop(1, 'rgba(0,0,0,0)');
    X.fillStyle = gl; X.beginPath(); X.arc(px, py - 10 - lift, r * 5, 0, E.TAU); X.fill();
    X.fillStyle = mid; X.beginPath(); X.arc(px, py - 10 - lift, r, 0, E.TAU); X.fill();
    X.fillStyle = core; X.beginPath(); X.arc(px, py - 11 - lift, r * 0.55, 0, E.TAU); X.fill();

    if (player.state === 'splash') {
      var t = Math.min(1, player.tHop / T.splashMs);
      X.globalAlpha = (1 - t) * 0.45;
      X.strokeStyle = C.stoneDim; X.lineWidth = 1.4;
      X.beginPath(); X.arc(px, py, 7 + t * 30, 0, E.TAU); X.stroke();
      X.globalAlpha = 1;
    }
    // tending, confirmed visually and statically: a thin steady ring — presence, held.
    // (Works with sound muted and under reduced motion; no animation, just there.)
    if (tending) {
      X.globalAlpha = 0.35;
      X.strokeStyle = C.ember; X.lineWidth = 1.2;
      X.beginPath(); X.arc(px, py - 10 - lift, r * 2.6, 0, E.TAU); X.stroke();
      X.globalAlpha = 1;
    }
  }

  /* ============================= INPUT ============================= */
  var pressT = 0, pressTimer = null, pressMoved = false;

  function canvasPoint(e) {
    var r = canvas.getBoundingClientRect();
    var cx = (e.clientX !== undefined ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0)) - r.left;
    var cy = (e.clientY !== undefined ? e.clientY : (e.touches && e.touches[0] ? e.touches[0].clientY : 0)) - r.top;
    return { x: cx, y: cy };
  }
  function pickStone(cx, cy) {
    var best = null, bd = 1e9;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.state === 'drowned' || (s.bornAt && now < s.bornAt)) continue;
      var d = Math.hypot(wx(s.x) - cx, wy(s.y) - cy);
      var tol = Math.max(48, T.unit * 0.5);
      if (d < tol && d < bd) { bd = d; best = s; }
    }
    return best;
  }
  function stepDir(dx, dy) {
    var best = null, bs = -1e9;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.state === 'drowned' || (s.bornAt && now < s.bornAt)) continue;
      var vx = s.x - player.x, vy = s.y - player.y, d = Math.hypot(vx, vy);
      if (d < 0.05 || d > T.reach + 0.08) continue;
      var dot = (vx * dx + vy * dy) / d;
      if (dot < 0.4) continue;
      var sc = dot * 2 - d * 0.5;
      if (sc > bs) { bs = sc; best = s; }
    }
    if (best) stepTo(best); else invalid();
  }
  function firstStepAnywhere() {
    // the very first input always commits a step — success inside 3 seconds of arriving
    var best = null, bd = 1e9;
    for (var i = 0; i < stones.length; i++) {
      var s = stones[i];
      if (s.state === 'drowned') continue;
      var d = E.dist(player.x, player.y, s.x, s.y);
      if (d <= T.reach + 0.08 && s.y > player.y && d < bd) { bd = d; best = s; }
    }
    if (best) stepTo(best);
  }

  /* the input-attention latch (ADR-030): raw device input only — it reads NO game state and
   * writes NO game state; it may only ever cause MORE frames to be painted, never fewer */
  function inputHeat() { lastInputAt = performance.now(); }

  function onDown(e) {
    inputHeat(); pointerHeld = true;
    if (e.isPrimary === false) return;                   // one finger owns the marsh
    if (e.cancelable) e.preventDefault();
    var pt = canvasPoint(e);
    pressMoved = false; pressT = performance.now();
    // tending arms on a sustained hold — with a felt confirmation, so a slow tap is never
    // silently swallowed (the hold announces itself; a short release still steps)
    clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      if (!pressMoved && player.state === 'idle') { tending = true; E.Audio.tend(); }
    }, T.tendMs);
    canvas.setPointerCapture && e.pointerId !== undefined && canvas.setPointerCapture(e.pointerId);
    canvas._downPt = pt;
  }
  function onUp(e) {
    inputHeat(); pointerHeld = false;
    if (e.isPrimary === false) return;
    clearTimeout(pressTimer);
    canvas._downPt = null;
    var held = performance.now() - pressT;
    if (tending) {
      tending = false; lastStepAt = now;
      // a deliberate-but-short press (a slow tap, not a chosen hold) still counts as a tap —
      // the kindest reading of an older thumb
      if (held >= 700) return;
    }
    var pt = canvasPoint(e);
    if (!firstStepEver) { firstStepAnywhere(); return; }
    var s = pickStone(pt.x, pt.y);
    if (s && reachable(s)) stepTo(s);
    else if (s) invalid();
    else {
      var dx = pt.x - wx(player.x), dy = -(pt.y - wy(player.y));
      var m = Math.hypot(dx, dy);
      if (m > 14) stepDir(dx / m, dy / m); else invalid();
    }
  }
  function onMove(e) {
    inputHeat();
    if (e.isPrimary === false) return;
    var pt = canvasPoint(e);
    if (canvas._downPt && Math.hypot(pt.x - canvas._downPt.x, pt.y - canvas._downPt.y) > 10) pressMoved = true;
    if (e.pointerType !== 'touch') {
      var s = pickStone(pt.x, pt.y);
      hoverStone = (s && s.state === 'ghost') ? s : null;
    }
  }
  function onKey(e) {
    inputHeat();
    if (!e.repeat && !keysDown[e.code]) { keysDown[e.code] = 1; keysHeld++; }
    // never steal keys from the chrome — a focused button/link keeps its keyboard behavior
    if (e.target && e.target.closest && e.target.closest('button, a')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat && !tending) { tending = true; E.Audio.tend(); }
      return;
    }
    var map = { ArrowUp: [0, 1], KeyW: [0, 1], ArrowDown: [0, -1], KeyS: [0, -1], ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0] };
    var v = map[e.code];
    if (v) {
      e.preventDefault();
      if (!firstStepEver) { firstStepAnywhere(); return; }
      stepDir(v[0], v[1]);
    }
  }
  function onKeyUp(e) {
    inputHeat();
    if (keysDown[e.code]) { delete keysDown[e.code]; keysHeld = Math.max(0, keysHeld - 1); }
    if (e.target && e.target.closest && e.target.closest('button, a')) return;
    if (e.code === 'Space') { tending = false; lastStepAt = now; }
  }

  /* update invalid pulse timer inside the loop */
  function tickPulse(dt) { invalidPulse = Math.max(0, invalidPulse - dt); }

  /* ambient sound scheduling: a water drip every 7-15s; a distant bell every 20-30s;
   * grace voices (the owl, the frogs); the still water's single acknowledging bell */
  var dripEvery = 10, bellEvery = 25, lastFrogCyc = -1;
  function tickAmbient() {
    if (!firstStepEver) return;
    if (now - lastDripAt > dripEvery) { lastDripAt = now; dripEvery = 7 + Math.random() * 8; E.Audio.drip(); }
    if (now - lastBellAt > bellEvery) { lastBellAt = now; bellEvery = 20 + Math.random() * 10; E.Audio.bellFar(); }
    if (field.grace === 'owl' && now - lastGraceSfx > 25 + Math.random() * 15) {
      lastGraceSfx = now; E.Audio.owl();
    }
    if (field.grace === 'owl' && !field._owlAnswered && now - (field._bornAt || 0) > 90) {
      // once a field, deep into it: the owl is answered from farther out, a fifth lower —
      // another life in the dark, also crossing
      field._owlAnswered = true; E.Audio.owlAnswer();
    }
    if (field.grace === 'shorebirds' && now - lastGraceSfx > 25 + Math.random() * 15) {
      lastGraceSfx = now; E.Audio.shorebirds();
    }
    if (field.grace === 'chord' && now - lastGraceSfx > 30 + Math.random() * 15) {
      // the chord is a real kindness, not a name: three soft tones across the water
      lastGraceSfx = now; E.Audio.chordFar();
    }
    if (field.grace === 'frogs') {
      var cyc = Math.floor(now / 10);
      if (cyc !== lastFrogCyc && (now % 10) < 0.2) { lastFrogCyc = cyc; E.Audio.gloop(); }
    }
    if (field._stillBellAt != null && now >= field._stillBellAt) {
      field._stillBellAt = null; E.Audio.bellFar();   // the still water, acknowledged once
    }
  }

  /* ============================= BOOT ============================= */
  /* one animation frame — the whole per-frame path, including the render-cadence gate.
   * Render cadence (ADR-030, canon law f): while the world is ASLEEP and no hand is on the
   * device, paint at a ~20fps time-gated floor instead of full rate. Presentation only —
   * update() runs first, unconditionally, every rAF: hesitation, the sleep ramp, nucleation,
   * drift, the traveler, and every audio timer are cadence-independent. `sleeping` cannot
   * flap across its 0.985 threshold (the ramp climbs at ~1/90 per second and retreat
   * requires an act or a non-idle state), and any transition forces a paint, so a single
   * crossing is invisible. The sleeping marsh renders slower, NEVER zero; Motion.tabHidden
   * (engine) remains the only full render pause. */
  function tickFrame(dt) {
    update(dt); tickPulse(dt); tickAmbient();
    var ts = performance.now();
    var hot = pointerHeld || keysHeld > 0 || (ts - lastInputAt) < 2000;
    if (sleeping && !hot && !forceDraw && (ts - lastDrawTs) < 50) { skippedFrames++; return; }
    forceDraw = false; lastDrawTs = ts; paintedFrames++;
    draw();
  }

  function resize() { var f = E.fit(canvas, 2); X = f.ctx; W = f.w; H = f.h; forceDraw = true; }
  function boot() {
    canvas = document.getElementById('marsh');
    if (!canvas) return;
    rand = E.rng(seed0);
    genField(); resetPlayer();
    resize();
    requestAnimationFrame(resize);
    setTimeout(resize, 120); setTimeout(resize, 600);
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 200); });
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointercancel', function () {
      // an interrupted press is not apathy: mirror onUp's bookkeeping
      inputHeat(); pointerHeld = false;
      clearTimeout(pressTimer);
      if (tending) { tending = false; lastStepAt = now; }
      canvas._downPt = null;
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    E.Motion.onChange(function () { forceDraw = true; });   // an RM toggle repaints at once
    var st = document.querySelector('[data-sound]');
    if (st) st.addEventListener('click', function () {
      E.Audio.enabled = !E.Audio.enabled;
      st.setAttribute('aria-pressed', String(E.Audio.enabled));
      st.textContent = E.Audio.enabled ? 'Sound: on' : 'Sound: off';
    });
    var run = E.loop(tickFrame);
    run.start();
    draw();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* verification handle (harmless in production; used for runtime checks) */
  global.ROLLO = {
    get state() {
      return { depth: depth, crossings: crossings, sleep: +sleep.toFixed(3), sleeping: sleeping,
        glow: player ? +player.glow.toFixed(3) : 0, leach: player ? +player.leach.toFixed(3) : 0,
        playerY: player ? +player.y.toFixed(2) : 0, playerState: player ? player.state : '',
        stones: stones.length, litPathLen: litPath.length, lamps: lamps.length,
        companion: !!companion, companionWaiting: !!(companion && companion.waiting),
        sinks: sinksThisCrossing, kindled: kindledThisCrossing, tending: tending,
        onShore: onShore, firstStep: firstStepEver, fieldH: fieldH,
        biome: field.biome.name, deepening: field.deepening, event: field.event,
        fogGeom: field.fogGeom, grace: field.grace,
        bellArmed: !!field._bellArmed, forkRow: field._forkRow || null,
        traveler: field._traveler ? { i: field._traveler.i, n: field._traveler.line.length,
          depart: !!field._traveler.depart } : null,
        paints: paintedFrames, skips: skippedFrames,
        renderHot: pointerHeld || keysHeld > 0 || (performance.now() - lastInputAt) < 2000 };
    },
    _step: stepDir, _stepTo: stepTo, _stones: function () { return stones; },
    _player: function () { return player; },
    _tick: function (dt, n) { n = n || 1; for (var i = 0; i < n; i++) { update(dt || 0.016); tickPulse(dt || 0.016); } draw(); },
    _frame: function (dt) { tickFrame(dt || 0.016); },   // the REAL per-frame path, gate included
    _tend: function (on) { tending = !!on; if (!on) lastStepAt = now; },
    _first: firstStepAnywhere
  };
})(window);

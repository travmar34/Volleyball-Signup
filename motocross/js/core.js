/* Core: math helpers, track (terrain) builder, level definitions.
   Pure JS, no rendering — also runs under Node for headless physics tests. */
(function (root) {
  'use strict';
  const MX = root.MX || (root.MX = {});

  // ---------- math ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  function rng(seed) { // mulberry32
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  MX.math = { clamp, lerp, smooth, wrapAngle, rng };

  // ---------- track ----------
  // The ridden surface is a height profile y(x) sampled every STEP metres.
  // Features append control points; the profile is the polyline through them.
  const STEP = 0.25;

  class TrackBuilder {
    constructor(startY) { this.pts = [[-60, startY], [0, startY]]; this.x = 0; this.y = startY; this.surf = []; this.markers = []; this.curSurf = 'dirt'; }
    add(x, y) { this.pts.push([x, y]); this.x = x; this.y = y; }
    surface(type) { this.surf.push([this.x, type]); this.curSurf = type; return this; }
    mark(kind, data) { this.markers.push(Object.assign({ kind, x: this.x, y: this.y }, data || {})); return this; }
    flat(len) { this.add(this.x + len, this.y); return this; }
    // smooth cosine slope
    slope(len, dy) {
      const x0 = this.x, y0 = this.y, n = Math.max(4, Math.ceil(len / 0.5));
      for (let i = 1; i <= n; i++) { const t = i / n; this.add(x0 + len * t, y0 + dy * (1 - Math.cos(Math.PI * t)) / 2); }
      return this;
    }
    // jump face: concave curve rising `h` over `len`, finishing at angle `deg`
    face(len, h, deg) {
      const x0 = this.x, y0 = this.y, n = Math.max(6, Math.ceil(len / 0.25));
      const endSlope = Math.tan(deg * Math.PI / 180);
      // quadratic-ish: y = h * f(t) with f'(1) scaled to endSlope; blend power curve
      const p = clamp(endSlope * len / h, 1.05, 6);
      for (let i = 1; i <= n; i++) { const t = i / n; this.add(x0 + len * t, y0 + h * Math.pow(t, p)); }
      return this;
    }
    // landing / down ramp: convex top that rolls into a slope down `h` over `len`
    down(len, h) {
      const x0 = this.x, y0 = this.y, n = Math.max(6, Math.ceil(len / 0.5));
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        // fast roll-over then long straight then smooth transition at bottom
        const s = (1 - Math.cos(Math.PI * t)) / 2 * 0.35 + t * 0.65; // mostly linear, rounded ends
        this.add(x0 + len * t, y0 - h * s);
      }
      return this;
    }
    up(len, h) { return this.slope(len, h); }
    // whoops / rollers
    whoops(n, spacing, h) {
      const x0 = this.x, y0 = this.y, steps = Math.ceil(spacing / 0.25);
      this.mark('whoops', { x1: x0 + n * spacing, h });
      for (let k = 0; k < n; k++) for (let i = 1; i <= steps; i++) {
        const t = i / steps; this.add(x0 + (k + t) * spacing, y0 + h * (1 - Math.cos(2 * Math.PI * t)) / 2);
      }
      return this;
    }
    // classic gap jump: face, lip, gap (pit), landing ramp
    gapJump(faceLen, h, deg, gap, landLen, landH, pitDepth) {
      this.face(faceLen, h, deg);
      const lipX = this.x, lipY = this.y;
      this.mark('jump', { lipX, lipY, gap });
      // back of kicker drops into pit
      const pit = pitDepth == null ? 1.5 : pitDepth;
      this.add(lipX + 0.6, lipY - 0.25);
      this.add(lipX + 1.6, this.y - (lipY - (lipY - h - pit)) * 0.5);
      const baseY = lipY - h;
      this.add(lipX + 2.5, baseY - pit * 0.6);
      this.add(lipX + gap * 0.5, baseY - pit);
      // landing peak at gap distance, height landH above base
      const landTopY = baseY + landH;
      this.add(lipX + gap - 2.0, landTopY - 1.2);
      this.add(lipX + gap - 0.6, landTopY - 0.15);
      this.add(lipX + gap, landTopY);
      this.add(lipX + gap + 1.2, landTopY - 0.05);
      this.down(landLen, landH);
      return this;
    }
    tabletop(faceLen, h, deg, top, landLen) {
      this.face(faceLen, h, deg);
      this.mark('jump', { lipX: this.x, lipY: this.y, gap: top });
      this.add(this.x + 0.8, this.y + 0.03);
      this.flat(top - 1.6);
      this.add(this.x + 0.8, this.y - 0.03);
      this.down(landLen, h);
      return this;
    }
    stepUp(faceLen, h, deg, top) {
      this.face(faceLen, h * 0.55, deg);
      this.mark('jump', { lipX: this.x, lipY: this.y, gap: 6 });
      const lx = this.x, ly = this.y;
      this.add(lx + 0.5, ly - 0.4);
      this.add(lx + 3.0, ly - 0.6);
      this.add(lx + 6.0, ly + h * 0.45 - 0.4);
      this.add(lx + 7.5, ly + h * 0.45);
      this.flat(top);
      return this;
    }
    build() {
      const pts = this.pts;
      const x0 = pts[0][0], x1 = pts[pts.length - 1][0] + 80;
      pts.push([x1, this.y]);
      const n = Math.floor((x1 - x0) / STEP) + 1;
      const h = new Float32Array(n);
      let j = 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * STEP;
        while (j < pts.length - 2 && pts[j + 1][0] < x) j++;
        const a = pts[j], b = pts[j + 1];
        const t = b[0] > a[0] ? clamp((x - a[0]) / (b[0] - a[0]), 0, 1) : 0;
        h[i] = lerp(a[1], b[1], t);
      }
      // gentle smoothing (keeps lips crisp-ish but removes polyline kinks)
      const hs = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = h[Math.max(0, i - 1)], b = h[i], c = h[Math.min(n - 1, i + 1)];
        hs[i] = (a + 2 * b + c) / 4;
      }
      return new Track(x0, hs, this.surf, this.markers);
    }
  }

  const SURFACES = {
    dirt: { mu: 1.05, roll: 0.018, color: [0.47, 0.33, 0.22], dust: [0.62, 0.5, 0.38] },
    hardpack: { mu: 1.0, roll: 0.012, color: [0.55, 0.42, 0.3], dust: [0.7, 0.6, 0.48] },
    loam: { mu: 1.15, roll: 0.03, color: [0.3, 0.21, 0.14], dust: [0.35, 0.25, 0.17] },
    sand: { mu: 0.85, roll: 0.07, color: [0.8, 0.68, 0.48], dust: [0.86, 0.76, 0.58] },
    mud: { mu: 0.62, roll: 0.06, color: [0.24, 0.17, 0.11], dust: [0.2, 0.14, 0.09] },
    clay: { mu: 0.95, roll: 0.015, color: [0.62, 0.3, 0.18], dust: [0.72, 0.45, 0.32] },
  };
  MX.SURFACES = SURFACES;

  class Track {
    constructor(x0, h, surf, markers) {
      this.x0 = x0; this.h = h; this.n = h.length; this.step = STEP;
      this.xEnd = x0 + (this.n - 1) * STEP;
      this.surf = surf.length ? surf : [[x0, 'dirt']];
      if (this.surf[0][0] > x0) this.surf.unshift([x0, this.surf[0][1]]);
      this.markers = markers;
    }
    heightAt(x) {
      const f = (x - this.x0) / STEP;
      let i = Math.floor(f);
      if (i < 0) return this.h[0];
      if (i >= this.n - 1) return this.h[this.n - 1];
      const t = f - i;
      return this.h[i] * (1 - t) + this.h[i + 1] * t;
    }
    slopeAt(x) { return (this.heightAt(x + 0.3) - this.heightAt(x - 0.3)) / 0.6; }
    avgSlope(x, w) { return (this.heightAt(x + w) - this.heightAt(x - w)) / (2 * w); }
    surfaceAt(x) {
      let s = this.surf[0][1];
      for (let i = 0; i < this.surf.length; i++) { if (this.surf[i][0] <= x) s = this.surf[i][1]; else break; }
      return s;
    }
    // circle vs polyline. returns deepest contact or null
    collide(px, py, r, out) {
      const i0 = Math.max(0, Math.floor((px - r - this.x0) / STEP) - 1);
      const i1 = Math.min(this.n - 2, Math.ceil((px + r - this.x0) / STEP) + 1);
      let best = 0, bnx = 0, bny = 1, bcx = 0, bcy = 0;
      for (let i = i0; i <= i1; i++) {
        const ax = this.x0 + i * STEP, ay = this.h[i], bx = ax + STEP, by = this.h[i + 1];
        const ex = bx - ax, ey = by - ay;
        let t = ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey);
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cx = ax + ex * t, cy = ay + ey * t;
        let dx = px - cx, dy = py - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        // segment outward normal (terrain is a heightfield so "up" side is outside)
        const len = Math.sqrt(ex * ex + ey * ey), snx = -ey / len, sny = ex / len;
        const side = dx * snx + dy * sny;
        let pen, nx, ny;
        if (side < 0) {
          // centre behind this segment: only trust it if the projection is interior
          if (t <= 0 || t >= 1) continue;
          pen = r - side; nx = snx; ny = sny;
          if (pen > r + 0.6) continue; // far behind a steep face: not this segment
        } else { if (d >= r) continue; pen = r - d; nx = d > 1e-6 ? dx / d : snx; ny = d > 1e-6 ? dy / d : sny; }
        if (pen > best) { best = pen; bnx = nx; bny = ny; bcx = cx; bcy = cy; }
      }
      if (best <= 0) return null;
      out.pen = best; out.nx = bnx; out.ny = bny; out.cx = bcx; out.cy = bcy;
      return out;
    }
    // heavily smoothed baseline for scenery around the track
    baseline(window) {
      const n = this.n, w = Math.round(window / STEP), out = new Float32Array(n);
      const pre = new Float64Array(n + 1);
      for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + this.h[i];
      for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), b = Math.min(n, i + w + 1); out[i] = (pre[b] - pre[a]) / (b - a); }
      return out;
    }
  }
  MX.Track = Track;
  MX.TrackBuilder = TrackBuilder;

  // ---------- levels ----------
  // Each level: id, name, mode ('race' | 'freestyle'), theme, build(tb), ai config, goals.
  const LEVELS = [
    {
      id: 'valley', name: 'Dusty Valley', mode: 'race', theme: 'day',
      blurb: 'Rolling hardpack, tabletops and your first doubles. Learn to pump the rollers and land on the downside.',
      ai: [{ name: 'R. Okafor', skill: 0.66, color: 0x1e5bd8, num: 27 }, { name: 'J. Lindqvist', skill: 0.6, color: 0x2aa84a, num: 51 }, { name: 'M. Duarte', skill: 0.55, color: 0xe0b400, num: 8 }],
      build(t) {
        t.surface('hardpack').mark('start').flat(34)
          .whoops(3, 9, 0.45).flat(14)
          .tabletop(7, 1.8, 24, 9, 9).flat(16)
          .slope(25, 4).flat(6).slope(20, -4).flat(12)
          .gapJump(7, 2.0, 27, 13, 10, 2.0, 0.8).flat(14).mark('checkpoint')
          .whoops(4, 6, 0.5).flat(12)
          .tabletop(8, 2.2, 26, 12, 10).flat(15)
          .surface('dirt').stepUp(5, 2.2, 30, 10).flat(4).down(14, 1.8).flat(16)
          .gapJump(8, 2.3, 28, 16, 12, 2.3, 1.0).flat(16).mark('checkpoint')
          .slope(30, 6).flat(8).tabletop(6, 1.5, 22, 8, 8).flat(6).slope(30, -6).flat(10)
          .whoops(5, 5, 0.45).flat(14)
          .gapJump(8, 2.4, 28, 18, 13, 2.4, 1.0).flat(16)
          .tabletop(7, 2.0, 25, 10, 10).flat(12).mark('checkpoint')
          .surface('hardpack').gapJump(9, 2.8, 30, 20, 14, 2.8, 1.2).flat(14)
          .whoops(3, 7, 0.7).flat(18).mark('finish').flat(60);
      },
    },
    {
      id: 'quarry', name: 'Red Rock Quarry', mode: 'freestyle', theme: 'quarry', time: 120,
      blurb: 'Freestyle. Steep kickers into long landings. Flip, hold tricks, stomp it clean. Combos multiply.',
      goals: { bronze: 9000, silver: 18000, gold: 30000 },
      build(t) {
        t.surface('clay').mark('start').flat(30);
        const jumps = [[8, 3.2, 38, 20, 16, 3.2], [9, 3.8, 40, 24, 18, 3.6], [8, 3.4, 42, 22, 16, 3.4], [10, 4.4, 42, 28, 20, 4.2], [9, 3.6, 45, 22, 17, 3.6], [11, 5.0, 44, 32, 22, 4.8]];
        for (let lap = 0; lap < 4; lap++) for (const j of jumps) { t.gapJump(j[0], j[1], j[2], j[3], j[4] * 1.5, j[5], 2.0).flat(22).mark('checkpoint'); }
        t.mark('finish').flat(60);
      },
    },
    {
      id: 'pines', name: 'Pine Ridge Whoops', mode: 'race', theme: 'forest',
      blurb: 'Loamy forest track. Long whoop sections, step-ups and a big triple. Stay on the gas through the whoops.',
      ai: [{ name: 'T. Brandt', skill: 0.86, color: 0xd82020, num: 3 }, { name: 'K. Sato', skill: 0.83, color: 0x1e5bd8, num: 14 }, { name: 'L. Moreau', skill: 0.80, color: 0xff7a00, num: 22 }],
      build(t) {
        t.surface('loam').mark('start').flat(30)
          .whoops(8, 4.5, 0.6).flat(14)
          .gapJump(8, 2.4, 28, 16, 12, 2.4, 1.0).flat(10)
          .slope(30, 8).stepUp(5, 2.4, 32, 10).flat(5).down(18, 2.2).slope(24, -8).flat(12).mark('checkpoint')
          .whoops(10, 4.2, 0.55).flat(14)
          .tabletop(9, 2.6, 28, 13, 12).flat(12)
          .gapJump(10, 3.0, 30, 22, 16, 3.0, 1.2).flat(14).mark('checkpoint')
          .slope(20, -5).whoops(6, 5, 0.5).flat(10).slope(30, 5).flat(8)
          .gapJump(8, 2.4, 28, 15, 12, 2.4, 1.0).flat(8)
          .gapJump(8, 2.4, 28, 15, 12, 2.4, 1.0).flat(14).mark('checkpoint')
          .surface('dirt').whoops(8, 4.5, 0.6).flat(34)
          .gapJump(11, 3.3, 31, 25, 18, 3.3, 1.4).flat(16)
          .tabletop(8, 2.2, 26, 11, 11).flat(20).mark('finish').flat(60);
      },
    },
    {
      id: 'mesa', name: 'Sunset Mesa', mode: 'freestyle', theme: 'sunset', time: 120,
      blurb: 'Freestyle. Huge desert gaps built for doubles. Big air means big flips — and big consequences.',
      goals: { bronze: 14000, silver: 28000, gold: 45000 },
      build(t) {
        t.surface('sand').mark('start').flat(20).surface('hardpack').flat(20);
        const jumps = [[10, 4.2, 42, 26, 20, 4.2], [12, 5.2, 44, 32, 24, 5.0], [10, 4.6, 46, 28, 20, 4.6], [13, 6.0, 45, 36, 26, 5.6]];
        for (let lap = 0; lap < 4; lap++) for (const j of jumps) { t.gapJump(j[0], j[1], j[2], j[3], j[4] * 1.5, j[5], 3.0).flat(26).mark('checkpoint'); }
        t.mark('finish').flat(60);
      },
    },
    {
      id: 'mud', name: 'Mudslide Hollow', mode: 'race', theme: 'rain',
      blurb: 'It has been raining for two days. Low grip, deep ruts, heavy bikes. Smooth throttle wins here.',
      ai: [{ name: 'D. Kowalski', skill: 0.90, color: 0x6a2bd8, num: 9 }, { name: 'A. Haugen', skill: 0.87, color: 0xd82020, num: 33 }, { name: 'C. Rivera', skill: 0.85, color: 0x18b8c8, num: 70 }],
      build(t) {
        t.surface('loam').mark('start').flat(30).surface('mud')
          .whoops(5, 5, 0.5).flat(12)
          .tabletop(8, 2.2, 26, 11, 11).flat(10)
          .slope(25, 6).surface('loam').stepUp(6, 2.6, 32, 9).flat(6).down(16, 2.4).surface('mud').slope(25, -6).flat(12).mark('checkpoint')
          .gapJump(9, 2.6, 28, 18, 14, 2.6, 1.0).flat(12)
          .whoops(7, 4.5, 0.5).flat(10)
          .surface('loam').gapJump(10, 3.0, 30, 22, 16, 3.0, 1.2).flat(10).surface('mud').flat(10).mark('checkpoint')
          .slope(30, 7).flat(5).slope(30, -7).flat(8)
          .tabletop(9, 2.6, 27, 13, 12).flat(10)
          .whoops(6, 5, 0.5).flat(12).mark('checkpoint')
          .surface('loam').gapJump(11, 3.2, 31, 24, 18, 3.2, 1.3).flat(10).surface('mud')
          .gapJump(8, 2.2, 27, 14, 12, 2.2, 0.9).flat(20).mark('finish').flat(60);
      },
    },
    {
      id: 'stadium', name: 'Night Supercross', mode: 'race', theme: 'night',
      blurb: 'Stadium supercross under the lights. Tight rhythm sections, a triple and the fastest riders in the series.',
      ai: [{ name: 'V. Castellan', skill: 0.95, color: 0xd82020, num: 1 }, { name: 'B. Nakamura', skill: 0.92, color: 0x1e5bd8, num: 2 }, { name: 'S. Okonkwo', skill: 0.89, color: 0x2aa84a, num: 4 }],
      build(t) {
        t.surface('clay').mark('start').flat(42)
          .gapJump(7, 2.2, 30, 13, 10, 2.2, 0.6).flat(6)
          .gapJump(6, 1.8, 30, 10, 8, 1.8, 0.5).flat(6)
          .tabletop(7, 2.0, 28, 9, 9).flat(10).mark('checkpoint')
          .whoops(10, 4.2, 0.5).flat(30)
          .gapJump(10, 3.0, 32, 24, 16, 3.0, 0.8).flat(10)
          .stepUp(5, 2.4, 34, 8).flat(3).down(12, 2.0).flat(10).mark('checkpoint')
          .gapJump(6, 1.8, 30, 10, 8, 1.8, 0.5).flat(4)
          .gapJump(6, 1.8, 30, 10, 8, 1.8, 0.5).flat(4)
          .gapJump(6, 1.8, 30, 10, 8, 1.8, 0.5).flat(10)
          .whoops(8, 4.2, 0.5).flat(28).mark('checkpoint')
          .gapJump(11, 3.2, 33, 26, 18, 3.2, 0.8).flat(10)
          .tabletop(7, 2.0, 28, 10, 9).flat(20).mark('finish').flat(60);
      },
    },
  ];
  MX.LEVELS = LEVELS;

  MX.buildLevel = function (level) {
    const tb = new TrackBuilder(0);
    level.build(tb);
    const track = tb.build();
    const start = track.markers.find((m) => m.kind === 'start');
    const fin = track.markers.find((m) => m.kind === 'finish');
    track.startX = start ? start.x + 4 : 4;
    track.finishX = fin ? fin.x : track.xEnd - 60;
    track.checkpoints = track.markers.filter((m) => m.kind === 'checkpoint').map((m) => m.x);
    track.jumps = track.markers.filter((m) => m.kind === 'jump');
    track.whoopsList = track.markers.filter((m) => m.kind === 'whoops');
    return track;
  };

  // choose a safe restart point behind `fromX` from a rider's history of {x, v} samples
  MX.respawnBike = function (bike, history, fromX) {
    const tr = bike.track;
    let spot = null;
    for (let i = history.length - 1; i >= 0; i--) {
      const h = history[i];
      if (h.x > fromX - 6) continue;
      const s = tr.slopeAt(h.x);
      if (s > 0.1 || s < -0.7) continue;
      if (tr.jumps.some((j) => h.x > j.lipX - 14 && h.x < j.lipX + 1)) continue;
      if ((tr.whoopsList || []).some((m) => h.x > m.x - 3 && h.x < m.x1)) continue;
      spot = h; break;
    }
    const x = spot ? spot.x : Math.max(tr.startX, fromX - 25);
    bike.reset(x);
    const v = spot ? Math.min(spot.v * 0.75, 15) : 0;
    const ang = Math.atan(tr.slopeAt(x));
    bike.vx = Math.cos(ang) * v; bike.vy = Math.sin(ang) * v;
    for (const w of bike.wheels) { w.vx = bike.vx; w.vy = bike.vy; w.w = v / 0.355; }
    bike.gear = v > 12 ? 2 : v > 7 ? 1 : 0;
    while (history.length && history[history.length - 1].x > x) history.pop();
    return x;
  };
  MX.recordHistory = function (bike, history) {
    if (bike.crashed || !(bike.wheels[0].ground && bike.wheels[1].ground)) return;
    if (Math.abs(wrapAngle(bike.a - Math.atan(bike.track.slopeAt(bike.x)))) > 0.3) return;
    if (!history.length || bike.x - history[history.length - 1].x > 2) { history.push({ x: bike.x, v: Math.max(0, bike.vx) }); if (history.length > 400) history.shift(); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = MX;
})(typeof window !== 'undefined' ? window : globalThis);

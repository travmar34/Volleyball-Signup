/* Motocross bike + rider physics.
   2D rigid-body chassis with two sprung wheels on telescopic fork / swingarm axes,
   penalty tyre contact with a velocity-level friction model, engine with torque curve
   and gearbox, brakes acting between wheel and chassis (so throttle / rear brake
   pitch the bike in the air), rider weight shift, trick poses and a verlet ragdoll. */
(function (root) {
  'use strict';
  const MX = root.MX;
  const { clamp, lerp, wrapAngle } = MX.math;

  const G = 9.81;
  const RAKE = 27 * Math.PI / 180;

  // geometry in chassis frame (origin = combined CoM, x forward, y up)
  const GEO = {
    wheelR: [0.355, 0.36],          // rear, front (tyre outer radius)
    travel: [0.31, 0.30],
    axis: [norm(0.32, -0.95), [Math.sin(RAKE), -Math.cos(RAKE)]],
    restAxle: [[-0.74, -0.64], [0.74, -0.64]],
    sag: [0.10, 0.08],
    pivot: [-0.18, -0.42],
    pegs: [-0.12, -0.53],
    bars: [0.31, 0.37],
    seat: [-0.3, -0.02],
  };
  GEO.anchor = [0, 1].map((i) => {
    const s = GEO.travel[i] - GEO.sag[i];
    return [GEO.restAxle[i][0] - s * GEO.axis[i][0], GEO.restAxle[i][1] - s * GEO.axis[i][1]];
  });
  function norm(x, y) { const l = Math.hypot(x, y); return [x / l, y / l]; }
  MX.GEO = GEO;

  // engine: 450cc four-stroke single
  const ENGINE = {
    idle: 1700, limit: 11800, peakT: 52,
    ratios: [19.5, 15.4, 12.9, 11.1, 9.7], eff: 0.9,
    inertia: 0.06,
  };
  function torqueCurve(rpm) {
    // N·m at the crank; broad mid-range, falls off past 9.5k
    const r = rpm / 1000;
    if (r < 2) return 22 + r * 8;
    if (r < 7.5) return 38 + (r - 2) * 2.6;
    if (r < 9.5) return 52.3 - (r - 7.5) * 1.2;
    return Math.max(0, 50 - (r - 9.5) * 9);
  }
  MX.torqueCurve = torqueCurve;

  // ---------- rider poses (chassis-local, z = lateral, +z = camera side / rider's left) ----------
  // joints: hip, neck, head, handL, handR, footL, footR ; knees/elbows by IK
  function basePose(lean, crouch) {
    const hx = -0.24 + lean * 0.22, hy = 0.22 - crouch * 0.14 - Math.abs(lean) * 0.05;
    const a = 0.62 + lean * 0.42; // torso angle from vertical
    const nx = hx + 0.52 * Math.sin(a), ny = hy + 0.52 * Math.cos(a);
    return {
      hip: [hx, hy, 0], neck: [nx, ny, 0], head: [nx + 0.2 * Math.sin(a + 0.25), ny + 0.2 * Math.cos(a + 0.25), 0],
      handL: [GEO.bars[0], GEO.bars[1], 0.38], handR: [GEO.bars[0], GEO.bars[1], -0.38],
      footL: [GEO.pegs[0], GEO.pegs[1], 0.2], footR: [GEO.pegs[0], GEO.pegs[1], -0.2],
      kneeHint: [1, 0.3, 0.15], elbowHint: [-0.6, -1, 0.6],
    };
  }
  const TRICKS = [
    { id: 'superman', name: 'Superman', key: '1', pts: 900, inT: 0.45, outT: 0.4, pose: {
      hip: [-0.38, 0.62, 0], neck: [0.06, 0.7, 0], head: [0.25, 0.78, 0],
      handL: [GEO.bars[0], GEO.bars[1], 0.38], handR: [GEO.bars[0], GEO.bars[1], -0.38],
      footL: [-1.25, 0.72, 0.16], footR: [-1.22, 0.64, -0.16], kneeHint: [0, -1, 0], elbowHint: [0, -1, 0.5] } },
    { id: 'heelclicker', name: 'Heel Clicker', key: '2', pts: 650, inT: 0.4, outT: 0.35, pose: {
      hip: [-0.2, 0.08, 0], neck: [-0.3, 0.6, 0], head: [-0.26, 0.82, 0],
      handL: [GEO.bars[0], GEO.bars[1], 0.38], handR: [GEO.bars[0], GEO.bars[1], -0.38],
      footL: [0.62, 0.72, 0.04], footR: [0.62, 0.72, -0.04], kneeHint: [0, 1, 0.4], elbowHint: [-1, -0.4, 0.6] } },
    { id: 'nacnac', name: 'Nac-Nac', key: '3', pts: 700, inT: 0.4, outT: 0.4, pose: {
      hip: [-0.26, 0.3, 0.1], neck: [0.08, 0.68, 0.06], head: [0.2, 0.86, 0.06],
      handL: [GEO.bars[0], GEO.bars[1], 0.38], handR: [GEO.bars[0], GEO.bars[1], -0.38],
      footL: [GEO.pegs[0], GEO.pegs[1], 0.2], footR: [-0.72, 0.28, 0.66], kneeHint: [1, 0.3, 0.15], kneeHintR: [-0.3, 0.4, 1], elbowHint: [-0.6, -1, 0.6] } },
    { id: 'cancan', name: 'Can-Can', key: '4', pts: 750, inT: 0.4, outT: 0.4, pose: {
      hip: [-0.22, 0.24, 0.05], neck: [0.06, 0.68, 0], head: [0.2, 0.86, 0],
      handL: [GEO.bars[0], GEO.bars[1], 0.38], handR: [GEO.bars[0], GEO.bars[1], -0.38],
      footL: [GEO.pegs[0], GEO.pegs[1], 0.2], footR: [0.42, 0.42, 0.66], kneeHint: [1, 0.3, 0.15], kneeHintR: [0.6, 0.8, 0.6], elbowHint: [-0.6, -1, 0.6] } },
    { id: 'cliffhanger', name: 'Cliffhanger', key: '5', pts: 1300, inT: 0.55, outT: 0.5, pose: {
      hip: [-0.08, 0.62, 0], neck: [-0.16, 1.14, 0], head: [-0.14, 1.36, 0],
      handL: [-0.1, 1.72, 0.42], handR: [-0.06, 1.72, -0.42],
      footL: [0.3, 0.32, 0.1], footR: [0.3, 0.32, -0.1], kneeHint: [1, 0, 0], elbowHint: [-1, 0, 1] } },
  ];
  MX.TRICKS = TRICKS;

  function blendPose(a, b, t) {
    const o = {};
    for (const k in a) { const bk = b[k] || (k === 'kneeHintR' ? null : a[k]); if (bk) o[k] = [lerp(a[k][0], bk[0], t), lerp(a[k][1], bk[1], t), lerp(a[k][2], bk[2], t)]; }
    if (b.kneeHintR) { const a2 = a.kneeHintR || [a.kneeHint[0], a.kneeHint[1], -a.kneeHint[2]]; o.kneeHintR = [lerp(a2[0], b.kneeHintR[0], t), lerp(a2[1], b.kneeHintR[1], t), lerp(a2[2], b.kneeHintR[2], t)]; }
    return o;
  }
  // two-bone IK in 3D: returns joint position
  function ik(a, c, l1, l2, hint) {
    let dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2];
    let d = Math.hypot(dx, dy, dz) || 1e-6;
    const dd = Math.min(d, l1 + l2 - 1e-4);
    const ux = dx / d, uy = dy / d, uz = dz / d;
    const x = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    // hint orthogonalised against u
    let hx = hint[0], hy = hint[1], hz = hint[2];
    const p = hx * ux + hy * uy + hz * uz; hx -= p * ux; hy -= p * uy; hz -= p * uz;
    const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
    return [a[0] + ux * x + hx * h, a[1] + uy * x + hy * h, a[2] + uz * x + hz * h];
  }
  const LIMB = { thigh: 0.45, shin: 0.46, upper: 0.31, fore: 0.3 };
  MX.LIMB = LIMB;

  // full skeleton in local frame from pose
  function skeleton(p) {
    const hipL = [p.hip[0], p.hip[1], p.hip[2] + 0.12], hipR = [p.hip[0], p.hip[1], p.hip[2] - 0.12];
    const shL = [p.neck[0] - 0.03, p.neck[1] - 0.05, p.neck[2] + 0.2], shR = [p.neck[0] - 0.03, p.neck[1] - 0.05, p.neck[2] - 0.2];
    const kh = p.kneeHint, eh = p.elbowHint;
    const kneeL = ik(hipL, p.footL, LIMB.thigh, LIMB.shin, kh);
    const kneeR = ik(hipR, p.footR, LIMB.thigh, LIMB.shin, p.kneeHintR || [kh[0], kh[1], -kh[2]]);
    const elbL = ik(shL, p.handL, LIMB.upper, LIMB.fore, eh);
    const elbR = ik(shR, p.handR, LIMB.upper, LIMB.fore, [eh[0], eh[1], -eh[2]]);
    // if hands can't reach, pull them to max reach
    const reach = (s, e, h) => { const dx = h[0] - s[0], dy = h[1] - s[1], dz = h[2] - s[2]; const d = Math.hypot(dx, dy, dz), m = LIMB.upper + LIMB.fore - 0.01; return d > m ? [s[0] + dx / d * m, s[1] + dy / d * m, s[2] + dz / d * m] : h; };
    const reachL = (s, h) => { const dx = h[0] - s[0], dy = h[1] - s[1], dz = h[2] - s[2]; const d = Math.hypot(dx, dy, dz), m = LIMB.thigh + LIMB.shin - 0.01; return d > m ? [s[0] + dx / d * m, s[1] + dy / d * m, s[2] + dz / d * m] : h; };
    return {
      head: p.head, neck: p.neck, hip: p.hip, hipL, hipR, shL, shR,
      kneeL, kneeR, elbL, elbR,
      handL: reach(shL, elbL, p.handL), handR: reach(shR, elbR, p.handR),
      footL: reachL(hipL, p.footL), footR: reachL(hipR, p.footR),
    };
  }
  MX.skeleton = skeleton;

  // ---------- ragdoll ----------
  const RAG_LINKS = [
    ['head', 'neck'], ['neck', 'hip'], ['head', 'hip'],
    ['neck', 'elbL'], ['elbL', 'handL'], ['neck', 'elbR'], ['elbR', 'handR'],
    ['hip', 'kneeL'], ['kneeL', 'footL'], ['hip', 'kneeR'], ['kneeR', 'footR'],
    ['neck', 'kneeL', 0.5], ['neck', 'kneeR', 0.5], ['head', 'elbL', 0.3], ['head', 'elbR', 0.3],
  ];
  class Ragdoll {
    constructor(skelWorld, vel, track) {
      this.track = track; this.p = {}; this.o = {};
      const dt = 1 / 120;
      for (const k of ['head', 'neck', 'hip', 'elbL', 'elbR', 'handL', 'handR', 'kneeL', 'kneeR', 'footL', 'footR']) {
        const s = skelWorld[k], v = vel(k);
        this.p[k] = [s[0], s[1], s[2]];
        this.o[k] = [s[0] - v[0] * dt, s[1] - v[1] * dt, s[2] - (v[2] || 0) * dt];
      }
      this.links = RAG_LINKS.map(([a, b, stiff]) => [a, b, Math.hypot(this.p[a][0] - this.p[b][0], this.p[a][1] - this.p[b][1], this.p[a][2] - this.p[b][2]), stiff == null ? 1 : stiff]);
      this.t = 0; this.impacts = 0;
    }
    step(dt) {
      this.t += dt;
      const g = G * dt * dt;
      for (const k in this.p) {
        const p = this.p[k], o = this.o[k];
        const vx = (p[0] - o[0]) * 0.999, vy = (p[1] - o[1]) * 0.999, vz = (p[2] - o[2]) * 0.98;
        o[0] = p[0]; o[1] = p[1]; o[2] = p[2];
        p[0] += vx; p[1] += vy - g; p[2] += vz;
      }
      for (let it = 0; it < 6; it++) {
        for (const [a, b, len, st] of this.links) {
          const pa = this.p[a], pb = this.p[b];
          const dx = pb[0] - pa[0], dy = pb[1] - pa[1], dz = pb[2] - pa[2];
          const d = Math.hypot(dx, dy, dz) || 1e-6, f = (d - len) / d * 0.5 * st;
          pa[0] += dx * f; pa[1] += dy * f; pa[2] += dz * f; pb[0] -= dx * f; pb[1] -= dy * f; pb[2] -= dz * f;
        }
        for (const k in this.p) {
          const p = this.p[k], o = this.o[k], r = k === 'head' ? 0.14 : 0.08;
          const gy = this.track.heightAt(p[0]) + r;
          if (p[1] < gy) {
            const vy = p[1] - o[1];
            if (vy < -0.05 && k === 'hip') this.impacts++;
            p[1] = gy;
            // ground friction: bleed horizontal velocity, small bounce
            o[0] = p[0] - (p[0] - o[0]) * 0.86;
            o[2] = p[2] - (p[2] - o[2]) * 0.8;
            o[1] = p[1] + vy * 0.25;
          }
        }
      }
    }
  }
  MX.Ragdoll = Ragdoll;

  // ---------- bike ----------
  class Bike {
    constructor(track, opts) {
      opts = opts || {};
      this.track = track;
      this.M = 172; this.I = 68;        // chassis+rider mass, pitch inertia
      this.mw = [14, 11];               // rear, front unsprung mass
      this.Iw = [1.2, 0.85];            // wheel spin inertia
      this.k = [9800, 8200];          // spring rate at the axle (N/m)
      this.preload = [0.012, 0.015];
      this.cComp = [1100, 900];        // damping N·s/m
      this.cReb = [1500, 1200];
      this.kPerp = 420000; this.cPerp = 3600;
      this.kTyre = 160000; this.cTyre = 900;
      this.tyreGrip = opts.grip || 1;
      this.power = opts.power || 1;
      this.name = opts.name || 'Rider';
      this.tc = opts.tc == null ? true : opts.tc;
      this.reset(opts.x || 0);
    }
    reset(x, keepGear) {
      const tr = this.track;
      const slope = Math.atan(tr.slopeAt(x));
      const groundY = Math.max(tr.heightAt(x - 0.8), tr.heightAt(x), tr.heightAt(x + 0.8));
      this.x = x; this.y = groundY + 1.02; this.a = slope; this.vx = 0; this.vy = 0; this.w = 0;
      this.wheels = [0, 1].map((i) => {
        const p = this.localToWorld(GEO.restAxle[i][0], GEO.restAxle[i][1]);
        return { x: p[0], y: p[1], vx: 0, vy: 0, spin: 0, w: 0, s: GEO.travel[i] - GEO.sag[i], ground: false, contact: 0, slip: 0, load: 0, nx: 0, ny: 1, surf: 'dirt' };
      });
      // settle on terrain
      const lift = 0.1; this.y += lift; for (const w of this.wheels) w.y += lift;
      this.gear = keepGear ? this.gear : 0; this.rpm = ENGINE.idle; this.shiftT = 0; this.clutch = 1;
      this.throttle = 0; this.brakeF = 0; this.brakeR = 0; this.lean = 0; this.leanS = 0; this.crouch = 0;
      this.crashed = false; this.crashT = 0; this.ragdoll = null;
      this.airT = 0; this.airborne = false; this.lastGroundA = slope;
      this.trick = null; this.trickT = 0; this.trickBlend = 0; this.trickOut = false;
      this.impact = 0; this.landingV = 0;
      this.hold = false;
      this.events = [];
      this.chassisContact = false;
      this.dist = 0;
      this.engineTorqueOut = 0;
    }
    localToWorld(lx, ly) {
      const c = Math.cos(this.a), s = Math.sin(this.a);
      return [this.x + c * lx - s * ly, this.y + s * lx + c * ly];
    }
    localVec(lx, ly) { const c = Math.cos(this.a), s = Math.sin(this.a); return [c * lx - s * ly, s * lx + c * ly]; }
    pointVel(px, py) { return [this.vx - this.w * (py - this.y), this.vy + this.w * (px - this.x)]; }
    axleLocal(i) {
      const w = this.wheels[i], c = Math.cos(this.a), s = Math.sin(this.a);
      const dx = w.x - this.x, dy = w.y - this.y;
      return [c * dx + s * dy, -s * dx + c * dy];
    }
    get speed() { return Math.hypot(this.vx, this.vy); }
    get onGround() { return this.wheels[0].ground || this.wheels[1].ground; }

    // controls: throttle 0..1, brake 0..1 (front+rear), lean -1..1 (+ = forward), trick index or -1
    setInput(inp) {
      this.throttle = clamp(inp.throttle || 0, 0, 1);
      this.brakeF = clamp(inp.brake || 0, 0, 1);
      this.brakeR = clamp(inp.brake || 0, 0, 1);
      this.lean = clamp(inp.lean || 0, -1, 1);
      this.wantTrick = inp.trick == null ? -1 : inp.trick;
    }

    step(dt) {
      if (this.crashed) { this.crashT += dt; if (this.ragdoll) this.ragdoll.step(dt); this.throttle = 0; this.brakeR = this.brakeF = 0.3; this.lean = 0; }
      const tr = this.track;
      const ca = Math.cos(this.a), sa = Math.sin(this.a);
      let fx = 0, fy = -this.M * G, tq = 0;
      const tmp = {};
      // rider lean smoothing (rider body has inertia)
      this.leanS += (this.lean - this.leanS) * Math.min(1, dt * 9);
      this.crouch += ((this.onGround ? 0.25 : 0) - this.crouch) * Math.min(1, dt * 4);

      // ---- engine / drivetrain ----
      const rear = this.wheels[0];
      const ratio = ENGINE.ratios[this.gear];
      const relSpin = rear.w + this.w; // wheel spin relative to chassis (cw positive)
      let rpmWheel = Math.abs(relSpin) * ratio * 60 / (2 * Math.PI);
      // clutch slip at low road speed
      const slipRpm = 2600 + this.throttle * 3600;
      if (this.hold) { this.clutch = 0; } else this.clutch = clamp(rpmWheel / slipRpm, 0, 1);
      const freeRpm = ENGINE.idle + this.throttle * (ENGINE.limit - ENGINE.idle) * (this.hold ? 0.75 : 0.55);
      const targetRpm = this.clutch >= 1 ? rpmWheel : lerp(Math.max(freeRpm, rpmWheel), rpmWheel, this.clutch * this.clutch);
      this.rpm += (Math.max(ENGINE.idle, targetRpm) - this.rpm) * Math.min(1, dt * (this.clutch >= 1 ? 40 : 8));
      let crank = 0;
      if (this.shiftT > 0) this.shiftT -= dt;
      else if (this.rpm < ENGINE.limit) crank = torqueCurve(this.rpm) * this.throttle * this.power;
      if (this.rpm > ENGINE.limit) crank = 0;
      // engine braking when closed
      const engBrake = (1 - this.throttle) * 0.0015 * this.rpm * this.clutch;
      let wheelT = (crank * ratio * ENGINE.eff) * Math.max(this.clutch, this.hold ? 0 : 0.35) - engBrake * ratio * Math.sign(relSpin);
      if (this.hold) wheelT = 0;
      // electronic wheelie / traction control (like modern MX ECU maps); rider can switch it off
      if (this.tc && wheelT > 0 && this.wheels[0].ground) {
        const rel = wrapAngle(this.a - Math.atan(this.track.slopeAt(this.x)));
        const p = rel + Math.max(0, this.w) * 0.18;
        if (p > 0.22) wheelT *= clamp(1 - (p - 0.22) * 3.2, 0.12, 1);
        const sl = this.wheels[0].slip;
        if (sl < -3) wheelT *= clamp(1 + (sl + 3) * 0.08, 0.5, 1);
      }
      this.engineTorqueOut = wheelT;
      // automatic gearbox
      if (!this.hold && this.shiftT <= 0) {
        if (this.rpm > 10600 && this.gear < ENGINE.ratios.length - 1 && this.clutch >= 1 && this.onGround) { this.gear++; this.shiftT = 0.09; this.events.push('shift'); }
        else if (this.rpm < 5200 && this.gear > 0) { this.gear--; this.shiftT = 0.06; }
      }

      // ---- wheels: suspension + contact ----
      this.chassisContact = false;
      for (let i = 0; i < 2; i++) {
        const w = this.wheels[i], r = GEO.wheelR[i];
        const ax = GEO.anchor[i], d = GEO.axis[i];
        const Ax = this.x + ca * ax[0] - sa * ax[1], Ay = this.y + sa * ax[0] + ca * ax[1];
        const Dx = ca * d[0] - sa * d[1], Dy = sa * d[0] + ca * d[1];
        const Nx = -Dy, Ny = Dx;
        const rx = w.x - Ax, ry = w.y - Ay;
        const s = rx * Dx + ry * Dy, e = rx * Nx + ry * Ny;
        const pv = this.pointVel(w.x, w.y);
        const rvx = w.vx - pv[0], rvy = w.vy - pv[1];
        const vs = rvx * Dx + rvy * Dy, ve = rvx * Nx + rvy * Ny;
        const T = GEO.travel[i];
        const comp = T - s; // compression
        let fAlong = this.k[i] * (Math.max(0, Math.min(comp, T)) + this.preload[i]) * (comp > 0 ? 1 : 0);
        if (s > T) fAlong -= this.kPerp * (s - T) + this.cPerp * Math.max(0, vs) * 0.5; // top-out
        fAlong -= (vs > 0 ? this.cReb[i] : this.cComp[i]) * vs;
        if (comp > T * 0.86) { const b = comp - T * 0.86; fAlong += 900000 * b * b + 2500 * Math.max(0, -vs) * (b / (T * 0.14)); } // bottoming cone
        if (comp > T) fAlong += this.kPerp * (comp - T) - this.cPerp * Math.min(0, vs);
        const fPerp = -(this.kPerp * e + this.cPerp * ve);
        const Fx = fAlong * Dx + fPerp * Nx, Fy = fAlong * Dy + fPerp * Ny;
        w.s = s; w.comp = comp;
        // ground
        let gx = 0, gy = 0, spinT = 0;
        w.ground = false; w.load = 0; w.slip = 0;
        const c = tr.collide(w.x, w.y, r, tmp);
        if (c) {
          const vn = w.vx * c.nx + w.vy * c.ny;
          let N = this.kTyre * c.pen - this.cTyre * vn;
          if (N > 0) {
            if (c.pen > 0.12) N += (c.pen - 0.12) * 2e6; // rim strike
            const sf = MX.SURFACES[w.surf = tr.surfaceAt(w.x)] || MX.SURFACES.dirt;
            w.ground = true; w.load = N; w.nx = c.nx; w.ny = c.ny;
            const tx = c.ny, ty = -c.nx;
            const vt = w.vx * tx + w.vy * ty;
            const slipV = vt - w.w * r;
            const invEff = 1 / this.mw[i] + r * r / this.Iw[i];
            const mu = sf.mu * this.tyreGrip;
            let Ft = -slipV / (dt * invEff) * 0.9;
            // rolling resistance, scaled by load
            const roll = sf.roll * N * Math.tanh(vt * 2);
            const lim = mu * N;
            if (Ft > lim) Ft = lim; else if (Ft < -lim) Ft = -lim;
            w.slip = slipV;
            gx = c.nx * N + tx * (Ft - roll); gy = c.ny * N + ty * (Ft - roll);
            spinT += -Ft * r;
            if (c.pen > 0.02 || N > 2000) w.contact = Math.max(w.contact, -vn);
          }
        }
        // drive / brake torques (cw positive on wheel, reaction on chassis CCW +)
        let tWheel = 0;
        if (i === 0) tWheel += wheelT;
        const bMax = i === 0 ? 650 : 1500;
        const bIn = i === 0 ? this.brakeR : this.brakeF;
        const relW = w.w + this.w;
        const bT = -bMax * bIn * clamp(relW * 0.8, -1, 1);
        tWheel += bT;
        // wheel linear
        w.vx += (Fx + gx) / this.mw[i] * dt;
        w.vy += ((Fy + gy) / this.mw[i] - G) * dt;
        w.w += (spinT + tWheel) / this.Iw[i] * dt;
        w.w *= 1 - 0.02 * dt;
        // chassis gets suspension force at wheel point and torque reaction
        fx -= Fx; fy -= Fy;
        tq -= (w.x - this.x) * Fy - (w.y - this.y) * Fx;
        tq += tWheel; // reaction: wheel cw torque => chassis CCW
      }

      // ---- chassis / rider body contacts ----
      const pts = this.contactPoints();
      for (const cp of pts) {
        const c = tr.collide(cp[0], cp[1], cp[2], tmp);
        if (!c) continue;
        const pv = this.pointVel(cp[0], cp[1]);
        const vn = pv[0] * c.nx + pv[1] * c.ny;
        let N = 120000 * c.pen - 3000 * vn;
        if (N <= 0) continue;
        const tx = c.ny, ty = -c.nx, vt = pv[0] * tx + pv[1] * ty;
        const Ft = -clamp(vt * 800, -0.6 * N, 0.6 * N);
        const Fx = c.nx * N + tx * Ft, Fy = c.ny * N + ty * Ft;
        fx += Fx; fy += Fy; tq += (cp[0] - this.x) * Fy - (cp[1] - this.y) * Fx;
        this.chassisContact = true;
        if (cp[3] && !this.crashed) this.crash(cp[3]);
        else if (!this.crashed && Math.abs(wrapAngle(this.a - Math.atan(tr.slopeAt(this.x)))) > 1.15) this.crash('loopout');
      }

      // ---- rider input torques ----
      if (!this.crashed) {
        const ctrl = 1 - this.trickBlend * 0.75;
        if (this.onGround) tq += -this.leanS * 700 * ctrl;
        else tq += -this.leanS * 1150 * ctrl - this.w * (Math.abs(this.lean) < 0.1 ? 40 : 6); // rider body throw; a neutral rider soaks up pitch
      }
      // aero drag
      const v = Math.hypot(this.vx, this.vy);
      fx -= 0.5 * 1.2 * 0.62 * v * this.vx; fy -= 0.5 * 1.2 * 0.62 * v * this.vy;

      // ---- integrate ----
      this.vx += fx / this.M * dt; this.vy += fy / this.M * dt; this.w += tq / this.I * dt;
      this.x += this.vx * dt; this.y += this.vy * dt; this.a += this.w * dt;
      for (const w of this.wheels) { w.x += w.vx * dt; w.y += w.vy * dt; w.spin += w.w * dt; }
      if (this.hold) { // gate: pin in place
        this.vx = 0; this.w *= 0.9; for (const w of this.wheels) { w.vx = 0; w.w = 0; }
      }
      this.dist = Math.max(this.dist, this.x);
      this.updateAir(dt);
    }

    // world contact probes: [x, y, r, crashReason?]
    contactPoints() {
      const out = [];
      const add = (lx, ly, r, why) => { const p = this.localToWorld(lx, ly); out.push([p[0], p[1], r, why]); };
      add(0.05, -0.58, 0.09, null);   // skid plate
      add(-1.0, 0.02, 0.06, null);    // rear fender
      add(0.86, -0.08, 0.07, null);   // front fender / plate
      add(0.32, 0.38, 0.06, null);    // bars
      if (!this.crashed) {
        const sk = this.skelLocal || skeleton(basePose(0, 0));
        add(sk.head[0], sk.head[1], 0.16, 'head');
        add(sk.neck[0], sk.neck[1], 0.15, 'body');
        add(sk.hip[0], sk.hip[1] + 0.05, 0.14, 'body');
      }
      return out;
    }

    updateAir(dt) {
      const grounded = this.wheels[0].ground || this.wheels[1].ground;
      const both = this.wheels[0].ground && this.wheels[1].ground;
      // trick state machine
      const tricks = TRICKS;
      if (this.trick) {
        const tk = this.trick;
        if (!this.trickOut && this.wantTrick !== tk.idx) this.trickOut = true;
        if (this.trickOut) { this.trickBlend -= dt / tk.outT; if (this.trickBlend <= 0) { this.trickBlend = 0; this.events.push({ type: 'trickEnd', trick: tk, held: this.trickT }); this.trick = null; } }
        else { this.trickBlend = Math.min(1, this.trickBlend + dt / tk.inT); if (this.trickBlend >= 1) this.trickT += dt; }
      } else if (this.wantTrick >= 0 && !grounded && !this.crashed && this.airT > 0.15) {
        this.trick = Object.assign({ idx: this.wantTrick }, tricks[this.wantTrick]); this.trickT = 0; this.trickOut = false; this.trickBlend = 0;
        this.events.push({ type: 'trickStart', trick: this.trick });
      }
      if (!grounded) {
        if (!this.airborne && this.airGrace > 0.12) { this.airborne = true; this.airT = this.airGrace; this.rot = 0; this.prevA = this.a; this.takeoffA = this.a; this.events.push({ type: 'takeoff' }); }
        this.airGrace = (this.airGrace || 0) + dt;
        if (this.airborne) {
          this.airT += dt;
          this.rot += wrapAngle(this.a - this.prevA); this.prevA = this.a;
        }
      } else {
        this.airGrace = 0;
        if (this.airborne) {
          this.airborne = false;
          const slope = Math.atan(this.track.slopeAt(this.x));
          const diff = Math.abs(wrapAngle(this.a - slope));
          const impact = Math.max(this.wheels[0].contact, this.wheels[1].contact);
          this.events.push({ type: 'land', airT: this.airT, rot: this.rot, diff, impact, trickBlend: this.trickBlend, both });
          if (this.trick && this.trickBlend > 0.3 && !this.crashed) this.crash('trick');
          else if (impact > 16.5 && !this.crashed) this.crash('impact');
          this.airT = 0;
        }
        this.wheels[0].contact = this.wheels[1].contact = 0;
      }
      // rider skeleton (local)
      let pose = basePose(this.leanS, this.crouch);
      if (this.trick) pose = blendPose(pose, this.trick.pose, MX.math.smooth(this.trickBlend));
      this.skelLocal = skeleton(pose);
    }

    crash(reason) {
      if (this.invulnerable) return;
      this.crashed = true; this.crashT = 0; this.crashReason = reason;
      this.trick = null; this.trickBlend = 0;
      const sw = this.skelWorld();
      this.ragdoll = new Ragdoll(sw, (k) => {
        const p = sw[k], v = this.pointVel(p[0], p[1]);
        return [v[0], v[1], (Math.random() - 0.3) * 1.5];
      }, this.track);
      this.events.push({ type: 'crash', reason });
    }

    skelWorld() {
      if (this.crashed && this.ragdoll) {
        const p = this.ragdoll.p;
        const off = (a, dz) => [a[0], a[1], a[2] + dz];
        return {
          head: p.head, neck: p.neck, hip: p.hip, hipL: off(p.hip, 0.12), hipR: off(p.hip, -0.12),
          shL: off(p.neck, 0.2), shR: off(p.neck, -0.2), elbL: p.elbL, elbR: p.elbR, handL: p.handL, handR: p.handR,
          kneeL: p.kneeL, kneeR: p.kneeR, footL: p.footL, footR: p.footR,
        };
      }
      const sk = this.skelLocal || skeleton(basePose(0, 0));
      const o = {};
      for (const k in sk) { const p = this.localToWorld(sk[k][0], sk[k][1]); o[k] = [p[0], p[1], sk[k][2]]; }
      return o;
    }
  }
  MX.Bike = Bike;
  MX.ENGINE = ENGINE;

  if (typeof module !== 'undefined' && module.exports) module.exports = MX;
})(typeof window !== 'undefined' ? window : globalThis);

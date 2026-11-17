/* CPU rider. Reads the track ahead, picks a launch speed for each jump from the
   projectile equation, rides the throttle/brakes to hit it, and in the air steers
   the bike's pitch to match the slope at the predicted landing point. */
(function (root) {
  'use strict';
  const MX = root.MX;
  const { clamp, wrapAngle } = MX.math;
  const G = 9.81;

  class AIRider {
    constructor(bike, skill, seed) {
      this.bike = bike; this.skill = skill;
      this.rand = MX.math.rng(seed || 1);
      this.noise = 0; this.noiseT = 0;
      this.react = 0.06 + (1 - skill) * 0.25;
      this.delayBuf = [];
      this.target = 0;
      this.calib = 1;
      this.settle = 0;
      bike.power = 0.6 + skill * 0.45;
      this.jumpErr = new Map();
      if (!bike.track.whoopsList) bike.track.whoopsList = bike.track.markers.filter((m) => m.kind === 'whoops');
    }
    // speed needed at the lip to land `aim` metres past the landing peak
    launchSpeed(j) {
      const tr = this.bike.track;
      const ang = Math.atan(tr.slopeAt(j.lipX - 0.4));
      const aim = Math.max(2, j.gap * 0.12) + 1.5;
      const dx = j.gap + aim, dy = tr.heightAt(j.lipX + dx) - j.lipY;
      const den = 2 * Math.cos(ang) ** 2 * (dx * Math.tan(ang) - dy);
      if (den <= 0) return 25;
      return Math.sqrt(G * dx * dx / den);
    }
    targetSpeed() {
      const b = this.bike, tr = b.track;
      const cruise = 11 + this.skill * 19;  // m/s cap on open ground
      let tgt = cruise;
      for (const j of tr.jumps) {
        const ahead = j.lipX - b.x;
        if (ahead < -1 || ahead > 70) continue;
        // speed needed now so that, after climbing the face, we leave the lip at launch speed
        const ls = this.launchSpeed(j);
        const dh = Math.max(0, j.lipY - (b.y - 1.0));
        const faceDeg = Math.atan(tr.slopeAt(j.lipX - 0.4)) * 180 / Math.PI;
        if (!this.jumpErr.has(j)) this.jumpErr.set(j, 1 + (this.rand() - 0.55) * (1 - this.skill) * 0.22);
        const v = Math.sqrt(ls * ls + 2 * G * dh * 0.82) * this.calib * (0.94 + clamp(faceDeg - 28, 0, 20) * 0.0045) * this.jumpErr.get(j);
        // allow deceleration over the remaining distance (~5 m/s² braking)
        const allow = Math.sqrt(v * v + 2 * 5.0 * Math.max(0, ahead - 10));
        tgt = Math.min(tgt, Math.max(v, Math.min(allow, cruise)));
        if (ahead < 10) tgt = v;
      }
      for (const m of tr.whoopsList) {
        if (b.x > m.x - 12 && b.x < m.x1) tgt = Math.min(tgt, 7 + this.skill * 11);
      }
      return tgt;
    }
    predictLanding() {
      const b = this.bike, tr = b.track;
      let x = b.x, y = b.y - 0.95, vx = b.vx, vy = b.vy;
      for (let t = 0; t < 4; t += 0.02) {
        vy -= G * 0.02; x += vx * 0.02; y += vy * 0.02;
        if (y <= tr.heightAt(x) && vy < 0) return { x, t };
      }
      return { x, t: 4 };
    }
    update(dt) {
      const b = this.bike, tr = b.track;
      const inp = { throttle: 0, brake: 0, lean: 0, trick: -1 };
      if (b.crashed) { this.cur = null; return inp; }
      // learn from each jump: nudge launch speed by how far long / short we landed
      if (b.airborne && !this.cur) {
        const j = tr.jumps.find((jj) => b.x - jj.lipX > -1 && b.x - jj.lipX < 5);
        if (j) this.cur = j;
      } else if (!b.airborne && this.cur && b.onGround) {
        const j = this.cur, aim = j.lipX + j.gap + Math.max(2, j.gap * 0.12) + 1.5;
        this.calib = clamp(this.calib * (1 - clamp(b.x - aim, -8, 8) * 0.004), 0.9, 1.1);
        this.settle = (1 - this.skill) * 1.6;
        this.cur = null;
      }
      this.noiseT -= dt;
      if (this.noiseT <= 0) { this.noiseT = 0.3 + this.rand() * 0.6; this.noise = (this.rand() - 0.5) * (1 - this.skill) * 1.6; }
      const slope = Math.atan(tr.avgSlope(b.x, 1.2));
      if (b.onGround) {
        const v = b.vx;
        this.target = this.targetSpeed();
        const err = this.target - v;
        inp.throttle = clamp(err * (0.3 + this.skill * 0.4) + 0.2, 0, 1) * (0.7 + this.skill * 0.3);
        if (this.settle > 0) { this.settle -= dt; inp.throttle *= 0.45; }
        if (err < -1.5) { inp.brake = clamp(-err * 0.25, 0, 1); inp.throttle = 0; }
        const rel = wrapAngle(b.a - slope);
        // keep the front down / avoid looping out: weight forward, feather throttle, cover the rear brake
        inp.lean = clamp(0.15 + (rel - 0.04) * 3.0 + b.w * 0.25, -1, 1);
        const wr = rel + b.w * 0.12;
        if (wr > 0.08) inp.throttle *= clamp(1 - (wr - 0.08) * 6, 0, 1);
        if (wr > 0.3) inp.brake = Math.max(inp.brake, clamp((wr - 0.3) * 3, 0, 0.8));
      } else {
        const land = this.predictLanding();
        const inWhoops = tr.whoopsList.some((m) => land.x > m.x - 2 && land.x < m.x1 + 2);
        let target = Math.atan(inWhoops ? tr.avgSlope(land.x, 3) : tr.slopeAt(land.x)) + 0.06;
        const err = wrapAngle(b.a - target);
        const kp = 2.2 + this.skill * 1.8, kd = 0.5 + this.skill * 0.25;
        inp.lean = clamp(err * kp + b.w * kd + this.noise * 0.4, -1, 1);
        // light throttle in the air to keep revs, as real riders do
        inp.throttle = err > 0.25 ? 0 : 0.3;
        if (err < -0.35) inp.throttle = 0.9; // gas it to lift the nose
        if (err > 0.35) inp.brake = 0.6;    // tap rear brake to drop the nose
      }
      return inp;
    }
  }
  MX.AIRider = AIRider;
  if (typeof module !== 'undefined' && module.exports) module.exports = MX;
})(typeof window !== 'undefined' ? window : globalThis);

/* Web Audio: synthesised single-cylinder four-stroke engine per bike, tyre/landing
   impacts, wind, crowd and UI beeps. No samples needed. */
(function (root) {
  'use strict';
  const MX = root.MX;
  const { clamp } = MX.math;

  class Audio {
    constructor() { this.ctx = null; this.enabled = true; this.voices = []; this.master = null; this.volume = 0.8; }
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = root.AudioContext || root.webkitAudioContext; if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.enabled ? this.volume : 0;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(ctx.destination);
      // shared noise buffer
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.6 + b * 3; }
      this.noise = buf;
      // wind
      this.wind = this.loopNoise(400, 0.6); this.wind.gain.gain.value = 0;
      this.crowd = this.loopNoise(900, 0.4); this.crowd.gain.gain.value = 0;
    }
    setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05); }
    loopNoise(freq, q) {
      const ctx = this.ctx, src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return { src, filter: f, gain: g };
    }
    // engine voice: pulse train at firing frequency through a resonant intake/exhaust filter
    engine(main) {
      if (!this.ctx) return null;
      const ctx = this.ctx;
      const out = ctx.createGain(); out.gain.value = 0;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const shaper = ctx.createWaveShaper();
      const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3.2); }
      shaper.curve = curve;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
      const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 160; body.gain.value = 8; body.Q.value = 1.2;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = ctx.createOscillator(); o2.type = 'square';
      const o3 = ctx.createOscillator(); o3.type = 'sawtooth';
      const g1 = ctx.createGain(), g2 = ctx.createGain(), g3 = ctx.createGain();
      g1.gain.value = 0.5; g2.gain.value = 0.22; g3.gain.value = 0.18;
      // combustion noise, amplitude-modulated at firing rate
      const ns = ctx.createBufferSource(); ns.buffer = this.noise; ns.loop = true;
      const nf = ctx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 900; nf.Q.value = 0.8;
      const ng = ctx.createGain(); ng.gain.value = 0;
      const am = ctx.createGain(); am.gain.value = 0.5; o2.connect(am); am.connect(ng.gain);
      o1.connect(g1); o2.connect(g2); o3.connect(g3);
      g1.connect(shaper); g2.connect(shaper); g3.connect(shaper);
      ns.connect(nf); nf.connect(ng); ng.connect(shaper);
      shaper.connect(body); body.connect(lp); lp.connect(out);
      if (pan) { out.connect(pan); pan.connect(this.master); } else out.connect(this.master);
      const t = ctx.currentTime; o1.start(t); o2.start(t); o3.start(t); ns.start(t);
      const v = { out, lp, o1, o2, o3, ng, nf, pan, main, nodes: [o1, o2, o3, ns] };
      this.voices.push(v);
      return v;
    }
    updateEngine(v, rpm, throttle, dist, panX, load) {
      if (!v || !this.ctx) return;
      const t = this.ctx.currentTime, fire = rpm / 120; // 4-stroke single: one bang every 2 revs
      v.o1.frequency.setTargetAtTime(fire, t, 0.015);
      v.o2.frequency.setTargetAtTime(fire * 0.5, t, 0.015);
      v.o3.frequency.setTargetAtTime(fire * 2.01, t, 0.015);
      v.lp.frequency.setTargetAtTime(380 + throttle * 2400 + rpm * 0.12, t, 0.03);
      v.nf.frequency.setTargetAtTime(500 + rpm * 0.18, t, 0.03);
      v.ng.gain.setTargetAtTime(0.08 + throttle * 0.35, t, 0.03);
      const vol = (v.main ? 0.32 : 0.2) * (0.35 + throttle * 0.65 + clamp(load || 0, 0, 0.3)) / (1 + Math.max(0, dist - 2) * 0.12);
      v.out.gain.setTargetAtTime(vol, t, 0.04);
      if (v.pan) v.pan.pan.setTargetAtTime(clamp(panX / 25, -0.9, 0.9), t, 0.05);
    }
    stopAll() {
      for (const v of this.voices) { try { v.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); for (const n of v.nodes) n.stop(this.ctx.currentTime + 0.3); } catch (e) { /* already stopped */ } }
      this.voices = [];
      if (this.wind) this.wind.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
      if (this.crowd) this.crowd.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    }
    setWind(speed, airborne) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.wind.gain.gain.setTargetAtTime(clamp(speed / 40, 0, 1) * (airborne ? 0.5 : 0.18), t, 0.15);
      this.wind.filter.frequency.setTargetAtTime(300 + speed * 25, t, 0.2);
    }
    setCrowd(level) { if (this.ctx) this.crowd.gain.gain.setTargetAtTime(level, this.ctx.currentTime, 0.4); }
    thud(strength) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 180 + strength * 30;
      const g = ctx.createGain(); g.gain.setValueAtTime(clamp(strength / 12, 0.05, 1) * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
      // suspension clack
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      const og = ctx.createGain(); og.gain.setValueAtTime(clamp(strength / 15, 0, 0.6), t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.2);
    }
    crash() {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const src = ctx.createBufferSource(); src.buffer = this.noise;
        const f = ctx.createBiquadFilter(); f.type = i % 2 ? 'highpass' : 'bandpass'; f.frequency.value = 400 + i * 900;
        const g = ctx.createGain(); const t0 = t + i * 0.09;
        g.gain.setValueAtTime(0.0001, t); g.gain.setValueAtTime(0.7 - i * 0.12, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);
        src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random()); src.stop(t0 + 0.5);
      }
    }
    beep(freq, dur) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.2));
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + (dur || 0.2) + 0.05);
    }
    cheer() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime; const g = this.crowd.gain.gain;
      g.cancelScheduledValues(t); g.setTargetAtTime(0.5, t, 0.15); g.setTargetAtTime(0.12, t + 1.2, 0.6);
    }
  }
  MX.Audio = Audio;
})(window);

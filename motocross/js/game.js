/* Game: menus, input (keyboard / touch / gamepad), race + freestyle rules, scoring,
   respawns, HUD and saved progress. */
(function (root) {
  'use strict';
  const MX = root.MX;
  const { clamp, wrapAngle } = MX.math;
  const $ = (id) => document.getElementById(id);
  const PHYS_DT = 1 / 600;
  const LANES = [0, -1.6, -3.2, -4.8];
  const SAVE_KEY = 'dirtridge-mx-v1';

  // ---------- persistence ----------
  function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (e) { return {}; } }
  function save(d) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(d)); } catch (e) { /* storage blocked */ } }
  const store = Object.assign({ levels: {}, settings: { quality: 'high', sound: true, touch: 'auto' }, unlockAll: false }, load());
  const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 };

  function fmtTime(t) { if (!isFinite(t)) return '--:--.-'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; }
  function ordinal(n) { return n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'); }
  function ordSup(n) { const o = ordinal(n); return `${n}<sup>${o.slice(String(n).length)}</sup>`; }

  // ---------- input ----------
  const keys = new Set();
  const touchKeys = new Set();
  const input = { throttle: 0, brake: 0, lean: 0, trick: -1 };
  const TRICK_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  root.addEventListener('keydown', (e) => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    keys.add(e.code);
    if (e.repeat) return;
    if (e.code === 'Escape' || e.code === 'KeyP') game.togglePause();
    if (e.code === 'KeyR') game.manualReset();
    if (e.code === 'Enter' && game.state === 'results') $('resNext').classList.contains('hidden') ? game.restart() : $('resNext').click();
  });
  root.addEventListener('keyup', (e) => keys.delete(e.code));
  root.addEventListener('blur', () => { keys.clear(); touchKeys.clear(); });

  function setupTouch() {
    const tc = $('touch');
    tc.querySelectorAll('button').forEach((b) => {
      const k = b.dataset.k;
      const on = (e) => { e.preventDefault(); touchKeys.add(k); b.classList.add('on'); game.audio.init(); };
      const off = (e) => { e.preventDefault(); touchKeys.delete(k); b.classList.remove('on'); };
      b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
    });
  }
  function touchWanted() {
    const s = store.settings.touch;
    if (s === 'on') return true; if (s === 'off') return false;
    return 'ontouchstart' in root || navigator.maxTouchPoints > 0;
  }

  let padPausePrev = false;
  function readInput(dt) {
    const k = (...c) => c.some((x) => keys.has(x));
    let wantT = k('ArrowUp', 'KeyW') || touchKeys.has('gas') ? 1 : 0;
    let brake = k('ArrowDown', 'KeyS', 'Space') || touchKeys.has('brake') ? 1 : 0;
    let lean = (k('ArrowRight', 'KeyD') || touchKeys.has('leanF') ? 1 : 0) - (k('ArrowLeft', 'KeyA') || touchKeys.has('leanB') ? 1 : 0);
    let trick = -1;
    TRICK_KEYS.forEach((c, i) => { if (keys.has(c) || touchKeys.has('t' + i)) trick = i; });
    // gamepad (analog)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let analogT = null;
    for (const p of pads) {
      if (!p) continue;
      const bt = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      if (bt(7) > 0.05) analogT = Math.max(analogT || 0, bt(7));
      if (bt(6) > 0.05) brake = Math.max(brake, bt(6));
      const ax = p.axes[0] || 0; if (Math.abs(ax) > 0.15) lean = clamp(ax, -1, 1);
      if (bt(14)) lean = -1; if (bt(15)) lean = 1; if (bt(12)) analogT = 1; if (bt(13)) brake = 1;
      [0, 1, 2, 3, 5].forEach((b, i) => { if (bt(b) > 0.5) trick = i; });
      const pz = bt(9) > 0.5; if (pz && !padPausePrev) game.togglePause(); padPausePrev = pz;
    }
    // digital throttle rolls on/off like a real wrist
    if (analogT != null) input.throttle = analogT;
    else input.throttle += clamp(wantT - input.throttle, -dt * 7, dt * 3.2);
    input.brake = brake; input.lean = lean; input.trick = trick;
    return input;
  }

  // ---------- game ----------
  class Game {
    constructor() {
      this.state = 'menu';
      this.renderer = new MX.Renderer($('view'));
      this.renderer.setQuality(store.settings.quality);
      this.audio = new MX.Audio(); this.audio.enabled = store.settings.sound;
      this.levelIdx = 0; this.t = 0; this.last = performance.now(); this.acc = 0;
      this.feedTimer = 0;
      this.buildMenu();
      this.bindUI();
      setupTouch();
      this.idleScene();
      requestAnimationFrame((t) => this.frame(t));
    }

    // a level rendered behind the menu, with a CPU rider doing laps
    idleScene() {
      const lv = MX.LEVELS[0];
      this.level = lv; this.track = MX.buildLevel(lv);
      this.renderer.buildLevel(lv, this.track);
      this.riders = [];
      const b = new MX.Bike(this.track, { x: this.track.startX + 20 });
      const r = { bike: b, ai: new MX.AIRider(b, 0.9, 3), name: 'demo', color: 0xff5a1f, num: 1, lane: 0, history: [], finished: false };
      r.vis = this.renderer.addBike(b, r.color, r.num, 0);
      this.riders.push(r); this.player = r; this.demo = true;
    }

    buildMenu() {
      const grid = $('levelGrid'); grid.innerHTML = '';
      const swatches = { day: 'linear-gradient(135deg,#3d7fd0,#6b8a3a)', quarry: 'linear-gradient(135deg,#d08a5a,#8a3a1a)', forest: 'linear-gradient(135deg,#3a5a3a,#1a2a1a)', sunset: 'linear-gradient(135deg,#ff9b55,#2c3570)', rain: 'linear-gradient(135deg,#59636e,#2a2f24)', night: 'linear-gradient(135deg,#1a2a5a,#000)' };
      MX.LEVELS.forEach((lv, i) => {
        const rec = store.levels[lv.id] || {};
        const unlocked = this.isUnlocked(i);
        const b = document.createElement('button');
        b.className = 'lvl' + (unlocked ? '' : ' locked');
        b.style.setProperty('--swatch', swatches[lv.theme] || '#333');
        const best = lv.mode === 'race' ? (rec.bestTime ? `Best: ${ordinal(rec.bestPos)} · ${fmtTime(rec.bestTime)}` : 'Not raced yet') : (rec.bestScore ? `Best: ${rec.bestScore.toLocaleString()} pts` : 'No score yet');
        b.innerHTML = `<div class="num">Track ${i + 1}</div><div class="name">${lv.name}</div><span class="mode ${lv.mode === 'race' ? 'race' : 'fs'}">${lv.mode === 'race' ? 'Race vs CPU' : 'Freestyle'}</span><div class="best">${unlocked ? best : 'Earn a medal on the previous track to unlock'}</div>${rec.medal ? `<span class="medalchip ${rec.medal}"></span>` : ''}`;
        b.addEventListener('click', () => { if (unlocked) this.showBrief(i); });
        grid.appendChild(b);
      });
    }
    isUnlocked(i) { if (i === 0 || store.unlockAll) return true; const prev = store.levels[MX.LEVELS[i - 1].id]; return !!(prev && prev.medal); }

    show(id) { for (const s of ['menu', 'brief', 'pause', 'results', 'controls', 'settings', 'loading']) $(s).classList.toggle('hidden', s !== id); }
    bindUI() {
      $('btnControls').onclick = () => { this.ctlReturn = 'menu'; this.show('controls'); };
      $('btnSettings').onclick = () => this.openSettings();
      $('ctlClose').onclick = () => this.show(this.ctlReturn || 'menu');
      $('briefBack').onclick = () => this.show('menu');
      $('briefGo').onclick = () => this.start(this.levelIdx);
      $('pResume').onclick = () => this.togglePause();
      $('pRestart').onclick = () => this.restart();
      $('pControls').onclick = () => { this.ctlReturn = 'pause'; this.show('controls'); };
      $('pMenu').onclick = () => this.toMenu();
      $('pauseBtn').onclick = () => this.togglePause();
      $('resMenu').onclick = () => this.toMenu();
      $('resRetry').onclick = () => this.restart();
      $('resNext').onclick = () => { if (this.levelIdx + 1 < MX.LEVELS.length) this.showBrief(this.levelIdx + 1); else this.toMenu(); };
      $('setClose').onclick = () => { this.show(this.settingsReturn || 'menu'); };
      $('setQuality').onchange = (e) => { store.settings.quality = e.target.value; save(store); this.renderer.setQuality(e.target.value); };
      $('setSound').onchange = (e) => { store.settings.sound = e.target.checked; save(store); this.audio.setEnabled(e.target.checked); };
      $('setTouch').onchange = (e) => { store.settings.touch = e.target.value; save(store); };
      $('setUnlock').onclick = () => { store.unlockAll = true; save(store); this.buildMenu(); $('setUnlock').textContent = 'All tracks unlocked'; };
      $('setReset').onclick = () => { if (confirm('Erase all medals and best times?')) { store.levels = {}; store.unlockAll = false; save(store); this.buildMenu(); } };
      document.addEventListener('pointerdown', () => this.audio.init(), { once: false });
    }
    openSettings() {
      this.settingsReturn = 'menu';
      $('setQuality').value = store.settings.quality; $('setSound').checked = store.settings.sound; $('setTouch').value = store.settings.touch;
      this.show('settings');
    }
    showBrief(i) {
      this.levelIdx = i; const lv = MX.LEVELS[i];
      $('briefMode').textContent = lv.mode === 'race' ? 'RACE · 4 RIDERS' : `FREESTYLE · ${lv.time}s`;
      $('briefName').textContent = lv.name; $('briefText').textContent = lv.blurb;
      const g = $('briefGoals');
      if (lv.mode === 'race') g.innerHTML = '<li><i class="medalchip gold"></i>Win the race</li><li><i class="medalchip silver"></i>Finish 2nd</li><li><i class="medalchip bronze"></i>Finish 3rd</li>';
      else g.innerHTML = ['gold', 'silver', 'bronze'].map((m) => `<li><i class="medalchip ${m}"></i>${lv.goals[m].toLocaleString()} points</li>`).join('');
      this.show('brief');
    }

    start(i) {
      this.audio.init(); this.audio.stopAll();
      this.show('loading');
      setTimeout(() => this.setupLevel(i), 30);
    }
    setupLevel(i) {
      try {
        const lv = this.level = MX.LEVELS[i]; this.levelIdx = i; this.demo = false;
        const tr = this.track = MX.buildLevel(lv);
        this.renderer.buildLevel(lv, tr);
        this.riders = [];
        const mk = (name, color, num, lane, ai) => {
          const b = new MX.Bike(tr, { x: tr.startX, name });
          const r = { bike: b, name, color, num, lane, ai: ai ? new MX.AIRider(b, ai.skill, num * 13 + 1) : null, history: [], finished: false, finishT: Infinity, crashes: 0 };
          r.vis = this.renderer.addBike(b, color, num, lane);
          r.voice = this.audio.engine(!ai);
          this.riders.push(r);
          return r;
        };
        this.player = mk('You', 0xff5a1f, 77, LANES[0], null);
        if (lv.mode === 'race') lv.ai.forEach((a, k) => mk(a.name, a.color, a.num, LANES[k + 1], a));
        for (const r of this.riders) { r.bike.hold = true; for (let s = 0; s < 400; s++) r.bike.step(PHYS_DT); }
        this.t = 0; this.raceT = 0; this.countdown = lv.mode === 'race' ? 3.6 : 1.2; this.lastBeep = 4;
        this.score = 0; this.combo = null; this.wheelieT = 0; this.stats = { flips: 0, tricks: 0, perfect: 0, bestCombo: 0, crashes: 0, maxAir: 0 };
        this.timeLeft = lv.time || 0;
        this.state = 'countdown';
        $('hud').classList.remove('hidden');
        $('hudScore').classList.toggle('hidden', lv.mode !== 'freestyle');
        $('hudPos').classList.toggle('hidden', lv.mode !== 'race');
        $('touch').classList.toggle('hidden', !touchWanted());
        $('trickFeed').innerHTML = ''; $('comboLine').textContent = '';
        this.buildProgress();
        this.show(null);
        this.audio.setCrowd(lv.theme === 'night' ? 0.12 : 0.03);
      } catch (e) { showErr(e); }
    }
    buildProgress() {
      const pd = $('progDots'); pd.innerHTML = '<b></b>';
      for (const r of this.riders) { const i = document.createElement('i'); i.style.background = '#' + new THREE.Color(r.color).getHexString(); if (r === this.player) i.className = 'me'; pd.appendChild(i); r.dot = i; }
    }
    restart() { this.start(this.levelIdx); }
    toMenu() {
      this.audio.stopAll(); this.state = 'menu';
      $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
      this.buildMenu(); this.show('menu'); this.idleScene();
    }
    togglePause() {
      if (this.state === 'racing' || this.state === 'countdown') { this.prevState = this.state; this.state = 'paused'; this.show('pause'); this.audio.setEnabled(false); }
      else if (this.state === 'paused') { this.state = this.prevState; this.show(null); this.audio.setEnabled(store.settings.sound); this.last = performance.now(); }
    }
    manualReset() {
      if ((this.state === 'racing') && this.player && !this.player.finished) {
        const b = this.player.bike;
        if (b.crashed && b.crashT < 0.6) return;
        this.respawn(this.player);
      }
    }

    // pick a safe spot behind where things went wrong and roll back in with some speed
    respawn(r) {
      const b = r.bike;
      const fromX = b.crashed && b.ragdoll ? Math.min(b.x, b.ragdoll.p.hip[0]) : b.x;
      MX.respawnBike(b, r.history, fromX);
      if (r === this.player) { this.combo = null; this.flash('', ''); this.renderer.camInit = false; }
    }

    frame(now) {
      requestAnimationFrame((t) => this.frame(t));
      let dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
      if (this.state === 'paused' || this.state === 'loading') { return; }
      try { this.tick(dt); } catch (e) { showErr(e); this.state = 'error'; }
    }

    tick(dt) {
      const R = this.renderer;
      this.t += dt;
      if (this.demo) { this.tickDemo(dt); return; }
      const st = this.state;
      const pin = readInput(dt);
      // countdown / gate
      if (st === 'countdown') {
        this.countdown -= dt;
        const n = Math.ceil(this.countdown - 0.6);
        if (n < this.lastBeep && n >= 1 && n <= 3) { this.lastBeep = n; this.audio.beep(440, 0.15); this.flash(String(n), ''); }
        if (this.countdown <= 0.6 && this.lastBeep > 0) { this.lastBeep = 0; this.audio.beep(880, 0.4); this.flash(this.level.mode === 'race' ? 'GO!' : 'RIDE!', 'go'); }
        if (this.countdown <= 0.6) { this.state = 'racing'; for (const r of this.riders) r.bike.hold = false; this.gateT = 0; }
      }
      if (this.state === 'racing') { this.raceT += dt; if (this.gateT != null) { this.gateT += dt; R.dropGates(this.gateT); } }
      // inputs
      for (const r of this.riders) {
        if (r.ai) {
          const ai = r.ai.update(dt);
          if (this.state === 'countdown') { ai.throttle = 0.35 + 0.25 * Math.sin(this.t * 5 + r.num); }
          if (r.finished) { ai.throttle = Math.min(ai.throttle, 0.25); ai.brake = r.bike.vx > 8 ? 0.4 : 0; }
          r.bike.setInput(ai);
        } else {
          const p = Object.assign({}, pin);
          if (r.finished) { p.throttle = 0; p.brake = r.bike.vx > 3 && r.bike.onGround ? 0.3 : 0; p.trick = -1; p.lean = 0; }
          r.bike.setInput(p);
        }
      }
      // physics
      this.acc += dt;
      let steps = 0;
      while (this.acc >= PHYS_DT && steps < 40) {
        for (const r of this.riders) r.bike.step(PHYS_DT);
        this.acc -= PHYS_DT; steps++;
      }
      if (steps >= 40) this.acc = 0;
      // per-rider bookkeeping
      for (const r of this.riders) this.riderLogic(r, dt);
      if (this.state === 'racing') this.rules(dt);
      // render + hud + audio
      R.update(dt, this.player.vis, this.t);
      R.render();
      this.hud(dt);
      this.sound();
    }

    tickDemo(dt) {
      const r = this.player, b = r.bike;
      b.setInput(r.ai.update(dt));
      this.acc += dt;
      while (this.acc >= PHYS_DT) { b.step(PHYS_DT); this.acc -= PHYS_DT; }
      b.events.length = 0;
      this.recordHistory(r);
      if (b.crashed && b.crashT > 2) this.respawn(r);
      if (b.x > this.track.finishX + 20) { b.reset(this.track.startX + 5); r.history = []; this.renderer.camInit = false; }
      this.renderer.update(dt, r.vis, this.t);
      this.renderer.render();
    }

    recordHistory(r) { MX.recordHistory(r.bike, r.history); }

    riderLogic(r, dt) {
      const b = r.bike, isP = r === this.player;
      this.recordHistory(r);
      for (const e of b.events) {
        if (e === 'shift') continue;
        if (e.type === 'crash') {
          r.crashes++;
          if (isP) { this.stats.crashes++; this.audio.crash(); this.renderer.shake = 0.35; const why = { head: 'HEADFIRST!', body: 'BAILED!', trick: 'TOO LATE TO TUCK IN!', impact: 'CASED IT!', loopout: 'LOOPED OUT!' }[e.reason] || 'CRASHED!'; this.flash(why, 'bad'); if (this.combo) { this.feed('Combo lost', ''); this.combo = null; } }
        } else if (e.type === 'land') {
          if (isP) {
            this.audio.thud(e.impact); this.renderer.shake = Math.min(0.25, e.impact * 0.015);
            this.stats.maxAir = Math.max(this.stats.maxAir, e.airT);
          }
          if (isP && this.combo && !b.crashed) this.landCombo(e);
        } else if (e.type === 'takeoff') {
          if (isP) this.combo = { tricks: [], pts: 0 };
        } else if (e.type === 'trickEnd') {
          if (isP && this.combo && !b.crashed) {
            const held = Math.min(e.held, 2.5);
            const p = Math.round(e.trick.pts * (0.7 + held * 0.6) / 10) * 10;
            this.combo.tricks.push(e.trick.name); this.combo.pts += p;
            this.feed(e.trick.name, '+' + p);
          }
        } else if (e.type === 'trickStart') {
          if (isP) $('comboLine').textContent = e.trick.name + '…';
        }
      }
      b.events.length = 0;
      // in-air live combo text
      if (isP && b.airborne && this.combo) {
        const rot = b.rot || 0, flips = Math.floor((Math.abs(rot) + 0.6) / (Math.PI * 2));
        const parts = [...this.combo.tricks];
        if (flips) parts.push((flips > 1 ? flips + 'x ' : '') + (rot > 0 ? 'Backflip' : 'Frontflip'));
        if (b.trick) parts.push(b.trick.name + (b.trickBlend >= 1 ? ' ' + b.trickT.toFixed(1) + 's' : ''));
        const air = b.airT > 0.8 ? `${b.airT.toFixed(1)} sec air` : '';
        $('comboLine').textContent = parts.join(' + ') + (parts.length && air ? '  ·  ' : '') + air;
      } else if (isP && !this.comboHold) $('comboLine').textContent = '';
      // wheelies / stoppies (freestyle points, and style anywhere)
      if (isP && this.level.mode === 'freestyle' && !b.crashed) {
        const rear = b.wheels[0].ground && !b.wheels[1].ground, front = b.wheels[1].ground && !b.wheels[0].ground;
        if ((rear || front) && b.vx > 3 && Math.abs(this.track.avgSlope(b.x, 2)) < 0.12) { this.wheelieT += dt; this.wheelieKind = rear ? 'Wheelie' : 'Stoppie'; }
        else if (this.wheelieT > 0) {
          if (this.wheelieT > 0.8 && b.wheels[0].ground && b.wheels[1].ground) { const p = Math.round(this.wheelieT * (this.wheelieKind === 'Stoppie' ? 450 : 300) / 10) * 10; this.score += p; this.feed(`${this.wheelieKind} ${this.wheelieT.toFixed(1)}s`, '+' + p); }
          if (b.wheels[0].ground && b.wheels[1].ground || b.airborne) this.wheelieT = 0;
        }
      }
      // crash recovery
      if (b.crashed && b.crashT > (r.ai ? 1.8 : 2.4) && !r.finished) this.respawn(r);
      // stuck (e.g. stalled on a face) — AI resets itself
      if (r.ai && this.state === 'racing' && !r.finished) {
        if (Math.abs(b.vx) < 0.6 && !b.crashed) { r.stuckT = (r.stuckT || 0) + dt; if (r.stuckT > 3) { r.stuckT = 0; this.respawn(r); } } else r.stuckT = 0;
      }
      // finish line
      if (!r.finished && this.state === 'racing' && b.x >= this.track.finishX) {
        r.finished = true; r.finishT = this.raceT; b.invulnerable = true;
        if (isP) this.finish();
      }
    }

    landCombo(e) {
      const c = this.combo; this.combo = null;
      const rot = e.rot || 0, flips = Math.floor((Math.abs(rot) + 0.6) / (Math.PI * 2));
      let pts = c.pts, parts = [...c.tricks];
      if (flips) { const f = rot > 0 ? 'Backflip' : 'Frontflip'; pts += flips * (rot > 0 ? 1500 : 2000) * (flips > 1 ? 1.5 : 1); parts.push((flips > 1 ? (flips === 2 ? 'Double ' : flips + 'x ') : '') + f); this.stats.flips += flips; }
      this.stats.tricks += c.tricks.length;
      const airPts = e.airT > 0.7 ? Math.round((e.airT - 0.7) * 150) : 0;
      if (!parts.length && airPts < 60) return;
      let quality = 'Clean', qm = 1;
      if (e.diff < 0.14 && e.impact < 9) { quality = 'Perfect landing'; qm = 1.5; this.stats.perfect++; }
      else if (e.diff > 0.38 || e.impact > 12.5) { quality = 'Sketchy'; qm = 0.6; }
      const mult = Math.max(1, parts.length);
      const total = Math.round(((pts + airPts) * mult * qm) / 10) * 10;
      if (this.level.mode === 'freestyle') this.score += total;
      this.stats.bestCombo = Math.max(this.stats.bestCombo, total);
      const label = parts.length ? parts.join(' + ') : `Air time ${e.airT.toFixed(1)} sec`;
      this.feed(label, `${quality}${mult > 1 ? ` · x${mult}` : ''} · +${total.toLocaleString()}`);
      if (parts.length && this.level.theme === 'night' || flips) this.audio.cheer();
      $('comboLine').textContent = '';
    }

    rules(dt) {
      const lv = this.level;
      if (lv.mode === 'freestyle') {
        this.timeLeft -= dt;
        if (this.timeLeft <= 0) { this.timeLeft = 0; this.player.finished = true; this.finish(); }
      }
    }

    placings() {
      return [...this.riders].map((r) => {
        const est = r.finished ? r.finishT : this.raceT + Math.max(0, this.track.finishX - r.bike.x) / Math.max(9, r.bike.vx);
        return { r, est };
      }).sort((a, b) => (a.r.finished && b.r.finished) ? a.est - b.est : (a.r.finished ? -1 : b.r.finished ? 1 : b.r.bike.x - a.r.bike.x));
    }

    finish() {
      this.state = 'results';
      const lv = this.level, rec = store.levels[lv.id] || (store.levels[lv.id] = {});
      let medal = null, html = '';
      if (lv.mode === 'race') {
        // finish the race for everyone still on track using their current pace
        const order = this.placings().map((p) => ({ r: p.r, t: p.r.finished ? p.r.finishT : p.est })).sort((a, b) => a.t - b.t);
        const pos = order.findIndex((o) => o.r === this.player) + 1;
        medal = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : null;
        $('resTitle').textContent = pos === 1 ? 'Victory!' : `${ordinal(pos)} place`;
        html = '<table class="res-table">' + order.map((o, i) => `<tr class="${o.r === this.player ? 'me' : ''}"><td>${i + 1}</td><td>#${o.r.num} ${o.r.name}</td><td>${fmtTime(o.t)}${i ? ` <small>+${(o.t - order[0].t).toFixed(1)}</small>` : ''}</td></tr>`).join('') + '</table>';
        html += `<div class="res-stat"><span>Crashes</span><b>${this.stats.crashes}</b></div><div class="res-stat"><span>Longest air</span><b>${this.stats.maxAir.toFixed(2)}s</b></div>`;
        if (!rec.bestTime || pos < rec.bestPos || (pos === rec.bestPos && this.player.finishT < rec.bestTime)) { rec.bestPos = pos; rec.bestTime = this.player.finishT; }
      } else {
        const s = this.score;
        medal = s >= lv.goals.gold ? 'gold' : s >= lv.goals.silver ? 'silver' : s >= lv.goals.bronze ? 'bronze' : null;
        $('resTitle').textContent = `${s.toLocaleString()} pts`;
        html = [['Flips', this.stats.flips], ['Tricks', this.stats.tricks], ['Perfect landings', this.stats.perfect], ['Best combo', this.stats.bestCombo.toLocaleString()], ['Longest air', this.stats.maxAir.toFixed(2) + 's'], ['Crashes', this.stats.crashes]]
          .map(([k, v]) => `<div class="res-stat"><span>${k}</span><b>${v}</b></div>`).join('');
        const next = !medal ? `Bronze needs ${lv.goals.bronze.toLocaleString()}` : medal !== 'gold' ? `Next medal at ${(medal === 'bronze' ? lv.goals.silver : lv.goals.gold).toLocaleString()}` : 'Gold — maximum style.';
        html += `<p class="hint">${next}</p>`;
        rec.bestScore = Math.max(rec.bestScore || 0, s);
      }
      if (medal && (!rec.medal || MEDAL_RANK[medal] > MEDAL_RANK[rec.medal])) rec.medal = medal;
      save(store);
      $('resMode').textContent = lv.name.toUpperCase() + (medal ? ` · ${medal.toUpperCase()} MEDAL` : '');
      $('resMedal').className = 'medal ' + (medal || '');
      $('resBody').innerHTML = html;
      const hasNext = this.levelIdx + 1 < MX.LEVELS.length && this.isUnlocked(this.levelIdx + 1);
      $('resNext').classList.toggle('hidden', !hasNext);
      if (!medal) $('resNext').classList.add('hidden');
      setTimeout(() => { if (this.state === 'results') this.show('results'); }, lv.mode === 'race' ? 1400 : 400);
      this.flash(lv.mode === 'race' ? 'FINISH' : 'TIME!', 'go');
      if (medal) this.audio.cheer();
    }

    flash(text, cls) {
      const el = $('bigMsg'); el.textContent = text; el.className = cls || '';
      clearTimeout(this.flashT); this.flashT = setTimeout(() => { el.textContent = ''; }, 1100);
    }
    feed(title, sub) {
      const f = $('trickFeed');
      const d = document.createElement('div'); d.className = 't'; d.innerHTML = `${title}${sub ? `<small>${sub}</small>` : ''}`;
      f.innerHTML = ''; f.appendChild(d);
    }

    hud() {
      const p = this.player, b = p.bike, lv = this.level;
      $('hudSpeed').textContent = Math.round(Math.max(0, b.speed) * 3.6);
      $('hudGear').textContent = b.gear + 1;
      $('hudRpm').style.width = clamp(b.rpm / MX.ENGINE.limit, 0, 1) * 100 + '%';
      const span = this.track.finishX - this.track.startX;
      for (const r of this.riders) r.dot.style.left = clamp((r.bike.x - this.track.startX) / span, 0, 1) * 100 + '%';
      if (lv.mode === 'race') {
        $('hudHint').textContent = '';
        const order = this.placings();
        const pos = order.findIndex((o) => o.r === p) + 1;
        $('hudPos').innerHTML = `${ordSup(pos)}<span>/${this.riders.length}</span>`;
        $('hudSub').textContent = fmtTime(this.raceT);
        $('hudGaps').innerHTML = order.map((o, i) => {
          const gap = i === 0 ? 'Leader' : (o.r.bike.x - order[0].r.bike.x).toFixed(0) + ' m';
          return `<div class="${o.r === p ? 'me' : ''}"><i style="background:#${new THREE.Color(o.r.color).getHexString()}"></i>${i + 1}. ${o.r.name} <span style="opacity:.6">${gap}</span></div>`;
        }).join('');
      } else {
        $('hudScore').textContent = this.score.toLocaleString();
        $('hudSub').textContent = '⏱ ' + fmtTime(Math.max(0, this.timeLeft));
        // FMX riders hit a kicker at a known speed: show it for the next jump
        const j = this.track.jumps.find((jj) => jj.lipX - b.x > 4 && jj.lipX - b.x < 80);
        if (j) {
          const ls = MX.AIRider.prototype.launchSpeed.call({ bike: b }, j);
          const deg = Math.atan(this.track.slopeAt(j.lipX - 0.4)) * 180 / Math.PI;
          const h = Math.max(0, j.lipY - this.track.heightAt(j.lipX - 12));
          const v = Math.sqrt(ls * ls + 2 * 9.81 * h * 0.82) * (0.94 + clamp(deg - 28, 0, 20) * 0.0045);
          $('hudHint').innerHTML = `${Math.round(j.gap)}m gap · hit it at <b>${Math.round(v * 3.6)}</b> km/h`;
        } else $('hudHint').textContent = '';
        $('hudGaps').innerHTML = `<div style="opacity:.75">Bronze ${lv.goals.bronze.toLocaleString()} · Silver ${lv.goals.silver.toLocaleString()} · Gold ${lv.goals.gold.toLocaleString()}</div>`;
      }
    }

    sound() {
      const p = this.player;
      for (const r of this.riders) {
        if (!r.voice) continue;
        const b = r.bike, dx = b.x - p.bike.x;
        const dist = Math.hypot(dx, r.lane - p.lane);
        this.audio.updateEngine(r.voice, b.crashed ? 1500 : b.rpm, b.crashed ? 0 : b.throttle, dist, dx, b.onGround ? clamp(b.engineTorqueOut / 1500, 0, 0.3) : 0);
      }
      this.audio.setWind(p.bike.speed, p.bike.airborne);
    }
  }

  function showErr(e) {
    console.error(e);
    const el = $('err'); el.classList.remove('hidden'); el.textContent = 'Error: ' + (e && e.stack || e);
  }
  let game;
  try {
    if (!root.THREE) throw new Error('three.js failed to load');
    game = new Game();
    root.__game = game;
  } catch (e) { showErr(e); }
})(window);

/* Three.js renderer: procedural terrain, sky, scenery, detailed bike + rider models,
   particle roost / dust, rain, follow camera. */
(function (root) {
  'use strict';
  const MX = root.MX;
  const T = root.THREE;
  const { clamp, lerp, rng } = MX.math;

  const THEMES = {
    day: { skyTop: 0x3d7fd0, skyHor: 0xcfe2ef, skyBot: 0xa9b7a0, sun: 0xfff2dc, sunI: 3.0, sunDir: [0.35, 0.8, 0.45], hemiSky: 0xbfd8ff, hemiGround: 0x6b5a40, hemiI: 1.0, grass: [0.30, 0.42, 0.17], grass2: [0.42, 0.48, 0.22], fogNear: 140, fogFar: 760, trees: 'mixed', mountains: [0x6f8a96, 0x8ea6b0], exposure: 0.95 },
    quarry: { skyTop: 0x4c8fd6, skyHor: 0xf2dcc2, skyBot: 0xc49a76, sun: 0xffeccc, sunI: 3.2, sunDir: [0.5, 0.75, 0.4], hemiSky: 0xdfe8ff, hemiGround: 0x8a4a2a, hemiI: 1.0, grass: [0.55, 0.36, 0.24], grass2: [0.62, 0.45, 0.3], fogNear: 160, fogFar: 800, trees: 'sparse', cliffs: 0xa4583a, mountains: [0x9a6a54, 0xb89a86], exposure: 0.95 },
    forest: { skyTop: 0x5a7fa6, skyHor: 0xc5d0d6, skyBot: 0x7a8a70, sun: 0xfff0d8, sunI: 2.2, sunDir: [0.25, 0.85, 0.5], hemiSky: 0xc0d0e0, hemiGround: 0x3a4a2a, hemiI: 1.25, grass: [0.2, 0.32, 0.12], grass2: [0.27, 0.36, 0.15], fogNear: 90, fogFar: 520, trees: 'forest', mountains: [0x4a6050, 0x6a8078], exposure: 1.0 },
    sunset: { skyTop: 0x2c3570, skyHor: 0xff9b55, skyBot: 0xb07050, sun: 0xffb070, sunI: 3.2, sunDir: [-0.55, 0.22, 0.45], hemiSky: 0xffb890, hemiGround: 0x6a3a2a, hemiI: 0.9, grass: [0.62, 0.44, 0.28], grass2: [0.7, 0.52, 0.34], fogNear: 180, fogFar: 900, trees: 'desert', mesas: true, mountains: [0x7a4038, 0xa45a48], exposure: 1.0 },
    rain: { skyTop: 0x59636e, skyHor: 0x97a1aa, skyBot: 0x6a705e, sun: 0xdde4ec, sunI: 1.1, sunDir: [0.2, 0.9, 0.4], hemiSky: 0xaab4c0, hemiGround: 0x3a3a2a, hemiI: 1.5, grass: [0.18, 0.28, 0.12], grass2: [0.22, 0.3, 0.14], fogNear: 50, fogFar: 330, trees: 'forest', rain: true, wet: true, mountains: [0x58626a, 0x707a82], exposure: 1.05 },
    night: { skyTop: 0x03050c, skyHor: 0x131a2a, skyBot: 0x0a0a10, sun: 0xdfe8ff, sunI: 2.6, sunDir: [0.1, 0.95, 0.35], hemiSky: 0x7080a0, hemiGround: 0x2a2018, hemiI: 0.55, grass: [0.12, 0.12, 0.13], grass2: [0.15, 0.15, 0.16], fogNear: 80, fogFar: 420, stadium: true, exposure: 1.1 },
  };
  MX.THEMES = THEMES;

  // ---------- procedural textures ----------
  function valueNoise(size, octaves, seed) {
    const r = rng(seed), data = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let o = 0; o < octaves; o++) {
      const cells = 4 << o, grid = [];
      for (let i = 0; i < (cells + 1) * (cells + 1); i++) grid.push(r());
      const g = (x, y) => grid[(y % cells) * (cells + 1) + (x % cells)];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = x / size * cells, fy = y / size * cells, ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const v = lerp(lerp(g(ix, iy), g(ix + 1, iy), sx), lerp(g(ix, iy + 1), g(ix + 1, iy + 1), sx), sy);
        data[y * size + x] += v * amp;
      }
      total += amp; amp *= 0.55;
    }
    for (let i = 0; i < data.length; i++) data[i] /= total;
    return data;
  }
  function makeGroundTextures(seed) {
    const S = 512, n = valueNoise(S, 6, seed);
    const r = rng(seed + 9);
    // pebbles / clods
    for (let k = 0; k < 900; k++) {
      const cx = r() * S, cy = r() * S, rad = 1 + r() * 3.5, hgt = 0.25 + r() * 0.3;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
        const d = Math.hypot(x, y); if (d > rad) continue;
        const ix = ((Math.floor(cx + x) % S) + S) % S, iy = ((Math.floor(cy + y) % S) + S) % S;
        n[iy * S + ix] += hgt * Math.sqrt(1 - d / rad);
      }
    }
    const cc = document.createElement('canvas'); cc.width = cc.height = S;
    const nc = document.createElement('canvas'); nc.width = nc.height = S;
    const ci = cc.getContext('2d').createImageData(S, S), ni = nc.getContext('2d').createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x, v = n[i];
      const c = clamp(150 + (v - 0.5) * 210, 40, 255);
      ci.data[i * 4] = c; ci.data[i * 4 + 1] = c; ci.data[i * 4 + 2] = c; ci.data[i * 4 + 3] = 255;
      const hx = n[y * S + ((x + 1) % S)] - n[y * S + ((x - 1 + S) % S)];
      const hy = n[((y + 1) % S) * S + x] - n[((y - 1 + S) % S) * S + x];
      let nx = -hx * 6, ny = -hy * 6, nz = 1; const l = Math.hypot(nx, ny, nz);
      ni.data[i * 4] = (nx / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; ni.data[i * 4 + 3] = 255;
    }
    cc.getContext('2d').putImageData(ci, 0, 0); nc.getContext('2d').putImageData(ni, 0, 0);
    const map = new T.CanvasTexture(cc), normal = new T.CanvasTexture(nc);
    for (const t of [map, normal]) { t.wrapS = t.wrapT = T.RepeatWrapping; t.anisotropy = 8; }
    map.colorSpace = T.SRGBColorSpace;
    return { map, normal };
  }
  function textTexture(text, opts) {
    opts = opts || {};
    const c = document.createElement('canvas'); c.width = opts.w || 256; c.height = opts.h || 128;
    const g = c.getContext('2d');
    g.fillStyle = opts.bg || '#fff'; g.fillRect(0, 0, c.width, c.height);
    if (opts.stripe) { g.fillStyle = opts.stripe; g.fillRect(0, c.height * 0.78, c.width, c.height * 0.22); }
    g.fillStyle = opts.fg || '#111'; g.font = `${opts.weight || 900} ${opts.size || 96}px ${opts.font || 'Impact, Arial Black, sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (opts.italic) { g.setTransform(1, 0, -0.2, 1, c.height * 0.1, 0); }
    g.fillText(text, c.width / 2, c.height / 2 + (opts.dy || 0));
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function checkerTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4'; g.fillRect(x * 16, y * 16, 16, 16); }
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.magFilter = T.NearestFilter; return t;
  }
  function softDot() {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new T.CanvasTexture(c);
  }

  // ---------- helpers ----------
  const UP = new T.Vector3(0, 1, 0), _v1 = new T.Vector3(), _v2 = new T.Vector3(), _q = new T.Quaternion();
  function orient(mesh, a, b, baseLen) {
    _v1.set(a[0], a[1], a[2]); _v2.set(b[0], b[1], b[2]);
    mesh.position.copy(_v1).add(_v2).multiplyScalar(0.5);
    _v2.sub(_v1); const len = _v2.length();
    if (len > 1e-5) { _q.setFromUnitVectors(UP, _v2.multiplyScalar(1 / len)); mesh.quaternion.copy(_q); }
    if (baseLen) mesh.scale.y = len / baseLen;
  }
  function mat(color, rough, metal, extra) { return new T.MeshStandardMaterial(Object.assign({ color, roughness: rough == null ? 0.6 : rough, metalness: metal || 0 }, extra || {})); }
  function shadowed(o) { o.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }
  function tube(a, b, r, m) { const g = new T.CylinderGeometry(r, r, 1, 10); const me = new T.Mesh(g, m); orient(me, a, b, 1); return me; }

  // ---------- bike model ----------
  function buildWheel(front, mats) {
    const g = new T.Group();
    const R = front ? 0.36 : 0.355, tubeR = front ? 0.052 : 0.062;
    const tyre = new T.Mesh(new T.TorusGeometry(R - tubeR, tubeR, 14, 48), mats.tyre);
    g.add(tyre);
    // knobs
    const knobG = new T.BoxGeometry(0.03, 0.026, 0.05);
    const nk = 52, knobs = new T.InstancedMesh(knobG, mats.tyre, nk * 2);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3();
    for (let i = 0; i < nk * 2; i++) {
      const a = (i / nk) * Math.PI * 2 + (i >= nk ? Math.PI / nk : 0), z = i >= nk ? 0.028 : -0.028;
      p.set(Math.cos(a) * (R - 0.004), Math.sin(a) * (R - 0.004), z);
      q.setFromAxisAngle(new T.Vector3(0, 0, 1), a);
      m4.compose(p, q, s); knobs.setMatrixAt(i, m4);
    }
    g.add(knobs);
    const rimR = R - tubeR * 2 + 0.01;
    const rim = new T.Mesh(new T.TorusGeometry(rimR, 0.013, 8, 48), mats.rim); g.add(rim);
    const rim2 = rim.clone(); rim2.scale.set(1, 1, 1.8); g.add(rim2);
    // spokes
    const sp = [];
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2, side = i % 2 ? 1 : -1, ha = a + side * 0.35;
      sp.push(Math.cos(ha) * 0.045, Math.sin(ha) * 0.045, side * 0.045, Math.cos(a) * rimR, Math.sin(a) * rimR, side * 0.004);
    }
    const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
    g.add(new T.LineSegments(sg, new T.LineBasicMaterial({ color: 0xbfc4c8 })));
    const hub = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 0.12, 16), mats.hub); hub.rotation.x = Math.PI / 2; g.add(hub);
    const disc = new T.Mesh(new T.CylinderGeometry(front ? 0.135 : 0.12, front ? 0.135 : 0.12, 0.006, 32), mats.disc);
    disc.rotation.x = Math.PI / 2; disc.position.z = -0.07; g.add(disc);
    return shadowed(g);
  }

  function buildBike(color, num) {
    const GEO = MX.GEO;
    const team = new T.Color(color);
    const mats = {
      tyre: mat(0x111111, 0.92), rim: mat(0x1a1a1a, 0.35, 0.8), hub: mat(0x9aa0a6, 0.35, 0.9), disc: mat(0x8a8f94, 0.3, 0.9),
      plastic: mat(team, 0.42, 0.0, { envMapIntensity: 0.8 }), white: mat(0xf2f2f0, 0.45), black: mat(0x161616, 0.7),
      alu: mat(0xb8bcc0, 0.32, 0.85), engine: mat(0x2e3033, 0.5, 0.6), gold: mat(0xd4a640, 0.3, 0.9), chrome: mat(0xdadfe4, 0.18, 1.0),
      spring: mat(team.clone().offsetHSL(0, 0, 0.1), 0.4, 0.3), seat: mat(0x1c1c1c, 0.85), pipe: mat(0x8d8478, 0.35, 0.9),
    };
    const root = new T.Group();
    const add = (m) => { root.add(m); return m; };
    // frame (twin spar aluminium) from steering head to pivot to rear subframe
    const head = [0.36, 0.1, 0], pivot = [GEO.pivot[0], GEO.pivot[1], 0];
    for (const z of [0.09, -0.09]) {
      add(tube([head[0], head[1], z * 0.5], [-0.02, 0.0, z], 0.03, mats.alu));
      add(tube([-0.02, 0.0, z], [pivot[0] + 0.02, pivot[1] + 0.12, z], 0.032, mats.alu));
      add(tube([pivot[0] + 0.02, pivot[1] + 0.12, z], [pivot[0], pivot[1] - 0.06, z], 0.03, mats.alu));
      add(tube([head[0], head[1] - 0.05, z * 0.3], [0.22, -0.48, z * 0.7], 0.022, mats.alu)); // downtube
      add(tube([-0.1, 0.0, z * 0.8], [-0.75, 0.08, z * 0.7], 0.016, mats.alu)); // subframe
      add(tube([pivot[0], pivot[1] + 0.05, z * 0.8], [-0.72, 0.04, z * 0.7], 0.014, mats.alu));
    }
    // engine
    const eng = add(new T.Mesh(new T.BoxGeometry(0.36, 0.3, 0.22), mats.engine)); eng.position.set(0.05, -0.42, 0); eng.rotation.z = 0.08;
    const cyl = add(new T.Mesh(new T.BoxGeometry(0.17, 0.22, 0.17), mats.engine)); cyl.position.set(0.12, -0.2, 0); cyl.rotation.z = -0.25;
    const fins = add(new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.05, 20), mats.alu)); fins.rotation.x = Math.PI / 2; fins.position.set(-0.02, -0.46, 0.115);
    const skid = add(new T.Mesh(new T.BoxGeometry(0.42, 0.03, 0.2), mats.black)); skid.position.set(0.05, -0.58, 0); skid.rotation.z = 0.06;
    // radiators + shrouds + tank
    for (const z of [0.13, -0.13]) {
      const rad = add(new T.Mesh(new T.BoxGeometry(0.12, 0.26, 0.04), mats.black)); rad.position.set(0.27, -0.12, z); rad.rotation.z = -0.35;
      const sh = add(new T.Mesh(new T.BoxGeometry(0.4, 0.24, 0.025), mats.plastic)); sh.position.set(0.22, -0.02, z * 1.18); sh.rotation.z = -0.32;
      const sh2 = add(new T.Mesh(new T.BoxGeometry(0.22, 0.12, 0.026), mats.white)); sh2.position.set(0.12, 0.02, z * 1.2); sh2.rotation.z = -0.1;
    }
    const tank = add(new T.Mesh(new T.BoxGeometry(0.34, 0.15, 0.24), mats.plastic)); tank.position.set(0.12, 0.03, 0); tank.rotation.z = -0.12;
    // seat
    const seat = add(new T.Mesh(new T.BoxGeometry(0.78, 0.07, 0.2), mats.seat)); seat.position.set(-0.32, 0.02, 0); seat.rotation.z = 0.06;
    // side panels with number
    const numTex = textTexture(String(num), { bg: '#f4f4f2', fg: '#111', size: 92, italic: true, stripe: '#' + team.getHexString() });
    const numMat = new T.MeshStandardMaterial({ map: numTex, roughness: 0.45 });
    for (const z of [0.115, -0.115]) {
      const sp = add(new T.Mesh(new T.PlaneGeometry(0.36, 0.2), numMat)); sp.position.set(-0.5, -0.06, z); sp.rotation.y = z > 0 ? 0 : Math.PI; sp.rotation.z = z > 0 ? 0.12 : -0.12;
    }
    // rear fender
    const rf = add(new T.Mesh(new T.BoxGeometry(0.55, 0.025, 0.16), mats.plastic)); rf.position.set(-0.86, 0.06, 0); rf.rotation.z = 0.22;
    // airbox / side cover
    const ab = add(new T.Mesh(new T.BoxGeometry(0.3, 0.2, 0.2), mats.black)); ab.position.set(-0.4, -0.13, 0);
    // exhaust (right side, away from camera) — header + silencer
    add(tube([0.22, -0.2, -0.04], [0.28, -0.42, -0.1], 0.024, mats.pipe));
    add(tube([0.28, -0.42, -0.1], [-0.15, -0.3, -0.14], 0.026, mats.pipe));
    const sil = add(tube([-0.15, -0.3, -0.14], [-0.75, -0.04, -0.14], 0.055, mats.alu));
    void sil;
    add(tube([-0.75, -0.04, -0.14], [-0.8, -0.02, -0.14], 0.03, mats.chrome));
    // front fender (attached to lower triple clamp)
    const ff = add(new T.Mesh(new T.BoxGeometry(0.62, 0.025, 0.14), mats.plastic)); ff.position.set(0.74, -0.18, 0); ff.rotation.z = -0.12;
    // number plate on forks
    const plate = add(new T.Mesh(new T.PlaneGeometry(0.22, 0.2), numMat)); plate.position.set(0.5, 0.26, 0); plate.rotation.y = Math.PI / 2; plate.rotation.z = 0; plate.rotation.x = 0;
    plate.rotation.order = 'YXZ'; plate.rotation.x = -0.45;
    // fork uppers (fixed) + triple clamps
    const d = GEO.axis[1], a = GEO.anchor[1];
    const topT = -0.62, botT = -0.12;
    for (const z of [0.085, -0.085]) {
      add(tube([a[0] + d[0] * topT, a[1] + d[1] * topT, z], [a[0] + d[0] * 0.06, a[1] + d[1] * 0.06, z], 0.026, mats.black));
    }
    const clampT = add(new T.Mesh(new T.BoxGeometry(0.08, 0.04, 0.24), mats.alu)); clampT.position.set(a[0] + d[0] * (topT + 0.04), a[1] + d[1] * (topT + 0.04), 0); clampT.rotation.z = RAKE_Z();
    const clampB = clampT.clone(); clampB.position.set(a[0] + d[0] * botT, a[1] + d[1] * botT, 0); add(clampB);
    // handlebar
    const bar = add(tube([GEO.bars[0], GEO.bars[1], 0.4], [GEO.bars[0], GEO.bars[1], -0.4], 0.012, mats.alu)); void bar;
    for (const z of [0.36, -0.36]) add(tube([GEO.bars[0], GEO.bars[1], z], [GEO.bars[0], GEO.bars[1], z + Math.sign(z) * 0.06], 0.02, mats.black));
    add(tube([a[0] + d[0] * topT, a[1] + d[1] * topT, 0], [GEO.bars[0], GEO.bars[1] - 0.01, 0], 0.016, mats.alu));
    // moving parts
    const lowers = [];
    for (const z of [0.085, -0.085]) { const lo = new T.Mesh(new T.CylinderGeometry(0.034, 0.034, 0.42, 12), mats.gold); lo.castShadow = true; root.add(lo); lowers.push([lo, z]); }
    const swing = new T.Mesh(new T.BoxGeometry(1, 0.07, 0.05), mats.alu); swing.castShadow = true;
    const swingL = swing.clone(), swingR = swing.clone(); swingL.position.z = 0.08; swingR.position.z = -0.08; root.add(swingL, swingR);
    const shockBody = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 1, 10), mats.chrome); root.add(shockBody);
    const shockSpring = new T.Mesh(new T.CylinderGeometry(0.048, 0.048, 1, 12, 1, true), mats.spring); root.add(shockSpring);
    const chain = new T.Mesh(new T.BoxGeometry(1, 0.012, 0.012), mats.black); root.add(chain);
    const wheelR = buildWheel(false, mats), wheelF = buildWheel(true, mats);
    root.add(wheelR, wheelF);
    shadowed(root);
    return { root, wheelR, wheelF, lowers, swingL, swingR, shockBody, shockSpring, chain, mats };
  }
  function RAKE_Z() { return -27 * Math.PI / 180; }

  function updateBikeModel(bm, bike, laneZ) {
    bm.root.position.set(bike.x, bike.y, laneZ);
    bm.root.rotation.z = bike.a;
    const GEO = MX.GEO;
    const ar = bike.axleLocal(0), af = bike.axleLocal(1);
    bm.wheelR.position.set(ar[0], ar[1], 0); bm.wheelR.rotation.z = -bike.wheels[0].spin;
    bm.wheelF.position.set(af[0], af[1], 0); bm.wheelF.rotation.z = -bike.wheels[1].spin;
    const d = GEO.axis[1];
    for (const [lo, z] of bm.lowers) orient(lo, [af[0], af[1], z], [af[0] - d[0] * 0.42, af[1] - d[1] * 0.42, z]);
    const pv = GEO.pivot;
    for (const s of [bm.swingL, bm.swingR]) {
      const dx = ar[0] - pv[0], dy = ar[1] - pv[1], len = Math.hypot(dx, dy);
      s.position.set((ar[0] + pv[0]) / 2, (ar[1] + pv[1]) / 2, s.position.z); s.rotation.z = Math.atan2(dy, dx); s.scale.x = len;
    }
    // shock from frame top to a point 1/3 along the swingarm
    const link = [lerp(pv[0], ar[0], 0.3), lerp(pv[1], ar[1], 0.3) + 0.05, 0];
    const top = [-0.16, -0.02, 0];
    orient(bm.shockBody, top, link, 1); orient(bm.shockSpring, [lerp(top[0], link[0], 0.08), lerp(top[1], link[1], 0.08), 0], [lerp(top[0], link[0], 0.68), lerp(top[1], link[1], 0.68), 0], 1);
    // chain: countershaft sprocket to rear sprocket
    const cs = [0.0, -0.4];
    const cdx = ar[0] - cs[0], cdy = ar[1] - cs[1];
    bm.chain.position.set((ar[0] + cs[0]) / 2, (ar[1] + cs[1]) / 2 + 0.03, 0.06); bm.chain.rotation.z = Math.atan2(cdy, cdx); bm.chain.scale.x = Math.hypot(cdx, cdy);
  }

  // ---------- rider model ----------
  function buildRider(color, num) {
    const team = new T.Color(color);
    const jersey = mat(team, 0.8), pants = mat(team.clone().lerp(new T.Color(0x222222), 0.55), 0.85);
    const white = mat(0xeeeeee, 0.6), black = mat(0x151515, 0.6);
    const helmetM = mat(team, 0.22, 0.15), helmet2 = mat(0xf4f4f4, 0.25, 0.1);
    const g = new T.Group();
    const L = MX.LIMB;
    const cap = (r, len, m) => { const me = new T.Mesh(new T.CapsuleGeometry(r, len, 4, 10), m); me.castShadow = true; g.add(me); return me; };
    const parts = {
      torso: cap(0.15, 0.32, jersey),
      thighL: cap(0.078, L.thigh - 0.04, pants), thighR: cap(0.078, L.thigh - 0.04, pants),
      shinL: cap(0.062, L.shin - 0.1, pants), shinR: cap(0.062, L.shin - 0.1, pants),
      upL: cap(0.056, L.upper - 0.04, jersey), upR: cap(0.056, L.upper - 0.04, jersey),
      foreL: cap(0.05, L.fore - 0.06, jersey), foreR: cap(0.05, L.fore - 0.06, jersey),
    };
    const bootG = new T.BoxGeometry(0.1, 0.32, 0.12);
    parts.bootL = new T.Mesh(bootG, white); parts.bootR = new T.Mesh(bootG, white);
    const gloveG = new T.SphereGeometry(0.05, 10, 8);
    parts.gloveL = new T.Mesh(gloveG, black); parts.gloveR = new T.Mesh(gloveG, black);
    // helmet group
    const helm = new T.Group();
    const shell = new T.Mesh(new T.SphereGeometry(0.15, 20, 16), helmetM); shell.scale.set(1.12, 1.0, 0.95); helm.add(shell);
    const chin = new T.Mesh(new T.BoxGeometry(0.12, 0.08, 0.16), helmet2); chin.position.set(0.12, -0.08, 0); chin.rotation.z = 0.5; helm.add(chin);
    const peak = new T.Mesh(new T.BoxGeometry(0.2, 0.015, 0.22), helmet2);
    const stripe = new T.Mesh(new T.TorusGeometry(0.15, 0.018, 6, 24, Math.PI), helmet2); stripe.rotation.x = Math.PI / 2; stripe.rotation.z = Math.PI / 2; stripe.scale.set(1.12, 1, 1); helm.add(stripe); peak.position.set(0.15, 0.09, 0); peak.rotation.z = -0.25; helm.add(peak);
    const gog = new T.Mesh(new T.BoxGeometry(0.06, 0.06, 0.2), mat(0x222a30, 0.1, 0.6)); gog.position.set(0.14, 0.0, 0); helm.add(gog);
    const strap = new T.Mesh(new T.TorusGeometry(0.152, 0.012, 6, 24), black); strap.rotation.y = Math.PI / 2; strap.scale.set(1, 0.9, 1.1); helm.add(strap);
    parts.helmet = helm;
    // number on back
    const nt = textTexture(String(num), { bg: '#' + team.getHexString(), fg: '#fff', size: 100 });
    parts.backNum = new T.Mesh(new T.PlaneGeometry(0.2, 0.14), new T.MeshStandardMaterial({ map: nt, roughness: 0.8 }));
    for (const k of ['bootL', 'bootR', 'gloveL', 'gloveR', 'helmet', 'backNum']) { g.add(parts[k]); shadowed(parts[k]); }
    return { root: g, parts };
  }
  const _m = new T.Matrix4(), _x = new T.Vector3(), _y = new T.Vector3(), _z = new T.Vector3();
  function updateRider(rm, sk, laneZ, bikeAngle) {
    const P = rm.parts;
    const w = (p) => [p[0], p[1], p[2] + laneZ];
    const hip = w(sk.hip), neck = w(sk.neck), head = w(sk.head);
    orient(P.torso, hip, neck, 0.62); P.torso.scale.set(1, P.torso.scale.y, 0.75);
    orient(P.thighL, w(sk.hipL), w(sk.kneeL)); orient(P.thighR, w(sk.hipR), w(sk.kneeR));
    orient(P.shinL, w(sk.kneeL), w(sk.footL)); orient(P.shinR, w(sk.kneeR), w(sk.footR));
    orient(P.upL, w(sk.shL), w(sk.elbL)); orient(P.upR, w(sk.shR), w(sk.elbR));
    orient(P.foreL, w(sk.elbL), w(sk.handL)); orient(P.foreR, w(sk.elbR), w(sk.handR));
    // boots: centred slightly up the shin from the foot
    for (const [b, k, f] of [[P.bootL, sk.kneeL, sk.footL], [P.bootR, sk.kneeR, sk.footR]]) {
      const kk = w(k), ff = w(f);
      orient(b, [lerp(ff[0], kk[0], 0.02), lerp(ff[1], kk[1], 0.02), ff[2]], [lerp(ff[0], kk[0], 0.62), lerp(ff[1], kk[1], 0.62), lerp(ff[2], kk[2], 0.62)]);
    }
    P.gloveL.position.set(...w(sk.handL)); P.gloveR.position.set(...w(sk.handR));
    // helmet faces along neck->head direction, rotated forward
    const dx = head[0] - neck[0], dy = head[1] - neck[1];
    P.helmet.position.set(head[0], head[1], head[2]);
    P.helmet.rotation.set(0, 0, Math.atan2(dy, dx) - Math.PI / 2 + 0.25 + 0 * bikeAngle);
    // back number: on the torso, facing away from bike front (visible from behind/side)
    _y.set(neck[0] - hip[0], neck[1] - hip[1], neck[2] - hip[2]).normalize();
    _z.set(0, 0, 1); _x.crossVectors(_z, _y).normalize(); // points out of the rider's back
    P.backNum.position.set(lerp(hip[0], neck[0], 0.6) + _x.x * 0.155, lerp(hip[1], neck[1], 0.6) + _x.y * 0.155, neck[2]);
    _m.makeBasis(_z, _y, _x); P.backNum.quaternion.setFromRotationMatrix(_m);
  }

  // ---------- particles ----------
  class Particles {
    constructor(scene, max) {
      this.max = max; this.n = 0;
      this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
      this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.size = new Float32Array(max); this.grow = new Float32Array(max);
      this.alpha = new Float32Array(max); this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('color', new T.BufferAttribute(this.col, 3).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('size', new T.BufferAttribute(this.size, 1).setUsage(T.DynamicDrawUsage));
      geo.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1).setUsage(T.DynamicDrawUsage));
      this.mat = new T.ShaderMaterial({
        uniforms: { map: { value: softDot() }, scale: { value: 500 }, fogColor: { value: new T.Color() }, fogNear: { value: 100 }, fogFar: { value: 500 } },
        vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying vec3 vC; varying float vA; varying float vD; uniform float scale;
          void main(){ vC=color; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0); vD=-mv.z; gl_PointSize=size*scale/max(0.1,-mv.z); gl_Position=projectionMatrix*mv; }`,
        fragmentShader: `uniform sampler2D map; uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; varying vec3 vC; varying float vA; varying float vD;
          void main(){ vec4 t=texture2D(map,gl_PointCoord); float f=smoothstep(fogNear,fogFar,vD); gl_FragColor=vec4(mix(vC,fogColor,f), t.a*vA); if(gl_FragColor.a<0.01) discard; }`,
        transparent: true, depthWrite: false,
      });
      this.points = new T.Points(geo, this.mat); this.points.frustumCulled = false;
      scene.add(this.points);
    }
    emit(x, y, z, vx, vy, vz, life, size, grow, color, alpha, grav, drag) {
      let i = this.n < this.max ? this.n++ : Math.floor(Math.random() * this.max);
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.col[i * 3] = color[0]; this.col[i * 3 + 1] = color[1]; this.col[i * 3 + 2] = color[2];
      this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow; this.a0[i] = alpha; this.alpha[i] = alpha; this.grav[i] = grav; this.drag[i] = drag;
    }
    update(dt, groundAt) {
      for (let i = 0; i < this.n; i++) {
        if (this.life[i] <= 0) continue;
        this.life[i] -= dt;
        if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
        const d = Math.exp(-this.drag[i] * dt);
        this.vel[i * 3] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt; this.vel[i * 3 + 2] *= d;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        const gy = groundAt(this.pos[i * 3]);
        if (this.pos[i * 3 + 1] < gy && this.grav[i] > 2) { this.pos[i * 3 + 1] = gy; this.vel[i * 3] *= 0.3; this.vel[i * 3 + 1] = 0; this.vel[i * 3 + 2] *= 0.3; }
        this.size[i] += this.grow[i] * dt;
        const t = this.life[i] / this.maxLife[i];
        this.alpha[i] = this.a0[i] * Math.min(1, t * 2.5) * (t > 0.9 ? (1 - t) * 10 : 1);
      }
      const g = this.points.geometry;
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; g.attributes.size.needsUpdate = true; g.attributes.alpha.needsUpdate = true;
      g.setDrawRange(0, this.n);
    }
    clear() { this.n = 0; }
  }

  // ---------- renderer ----------
  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
      this.gl.outputColorSpace = T.SRGBColorSpace;
      this.gl.toneMapping = T.ACESFilmicToneMapping;
      this.gl.shadowMap.enabled = true; this.gl.shadowMap.type = T.PCFSoftShadowMap;
      this.quality = 'high';
      this.camera = new T.PerspectiveCamera(42, 1, 0.1, 2000);
      this.camPos = new T.Vector3(); this.camLook = new T.Vector3(); this.shake = 0; this.camInit = false;
      this.resize();
      root.addEventListener('resize', () => this.resize());
    }
    setQuality(q) {
      this.quality = q;
      this.gl.setPixelRatio(q === 'low' ? Math.min(1, root.devicePixelRatio) : Math.min(2, root.devicePixelRatio));
      this.gl.shadowMap.enabled = q !== 'low';
      if (this.sun) { this.sun.castShadow = q !== 'low'; this.sun.shadow.mapSize.set(q === 'high' ? 2048 : 1024, q === 'high' ? 2048 : 1024); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
      this.resize();
    }
    resize() {
      const w = root.innerWidth, h = root.innerHeight;
      this.gl.setPixelRatio(this.quality === 'low' ? Math.min(1, root.devicePixelRatio) : Math.min(2, root.devicePixelRatio));
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w / h < 1 ? 58 : 42;
      this.camera.updateProjectionMatrix();
      if (this.particles) this.particles.mat.uniforms.scale.value = h * this.gl.getPixelRatio() * this.camera.projectionMatrix.elements[5] / 2;
    }
    dispose() {
      if (!this.scene) return;
      this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); } } });
      this.scene = null;
    }

    buildLevel(level, track) {
      this.dispose();
      const th = this.theme = THEMES[level.theme] || THEMES.day;
      this.track = track; this.level = level;
      const scene = this.scene = new T.Scene();
      scene.fog = new T.Fog(th.skyHor, th.fogNear, th.fogFar);
      this.gl.toneMappingExposure = th.exposure;
      // lights
      const hemi = new T.HemisphereLight(th.hemiSky, th.hemiGround, th.hemiI); scene.add(hemi);
      const sun = this.sun = new T.DirectionalLight(th.sun, th.sunI);
      this.sunDir = new T.Vector3(...th.sunDir).normalize();
      sun.castShadow = this.quality !== 'low';
      sun.shadow.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
      const sc = sun.shadow.camera; sc.left = -28; sc.right = 28; sc.top = 20; sc.bottom = -20; sc.near = 1; sc.far = 160;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
      scene.add(sun, sun.target);
      this.buildSky(th);
      this.buildTerrain(track, th);
      this.buildBackdrop(track, th, level);
      this.buildProps(track, th, level);
      this.particles = new Particles(scene, 2600);
      this.particles.mat.uniforms.fogColor.value.set(th.skyHor); this.particles.mat.uniforms.fogNear.value = th.fogNear; this.particles.mat.uniforms.fogFar.value = th.fogFar;
      if (th.rain) this.buildRain();
      this.bikes = [];
      this.camInit = false;
      this.resize();
    }

    buildSky(th) {
      const g = new T.SphereGeometry(1500, 32, 16);
      const sunDir = new T.Vector3(...th.sunDir).normalize();
      const m = new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false, fog: false,
        uniforms: { top: { value: new T.Color(th.skyTop) }, hor: { value: new T.Color(th.skyHor) }, bot: { value: new T.Color(th.skyBot) }, sunDir: { value: sunDir }, sunCol: { value: new T.Color(th.sun) }, stars: { value: th.stadium ? 1 : 0 } },
        vertexShader: 'varying vec3 vW; void main(){ vW = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top, hor, bot, sunCol, sunDir; uniform float stars; varying vec3 vW;
          float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164)))*43758.5453); }
          void main(){ float y = vW.y; vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y*1.6,0.0,1.0), 0.6)) : mix(hor, bot, clamp(-y*5.0,0.0,1.0));
            float s = max(0.0, dot(vW, sunDir)); c += sunCol * (pow(s, 900.0)*6.0 + pow(s, 12.0)*0.35 + pow(s,3.0)*0.08) * (1.0 - stars);
            if (stars > 0.5 && y > 0.05) { vec3 q = floor(vW*400.0); float r = h(q); c += vec3(step(0.997, r)) * 0.8 * clamp(y*3.0,0.0,1.0); }
            gl_FragColor = vec4(c, 1.0); }`,
      });
      this.sky = new T.Mesh(g, m); this.sky.frustumCulled = false; this.sky.renderOrder = -10;
      this.scene.add(this.sky);
    }

    // height of the world at (x, z): track inside the lanes, blending to rolling ground outside
    buildTerrain(track, th) {
      const base = track.baseline(25);
      const STEP = track.step;
      const bAt = (x) => { const f = (x - track.x0) / STEP; const i = clamp(Math.floor(f), 0, track.n - 2); const t = clamp(f - i, 0, 1); return base[i] * (1 - t) + base[i + 1] * t; };
      const r = rng(1234);
      const nz = valueNoise(128, 4, 77);
      const noise = (x, z) => { const ix = ((Math.floor(x * 0.35) % 128) + 128) % 128, iz = ((Math.floor(z * 0.35) % 128) + 128) % 128; return nz[iz * 128 + ix] - 0.5; };
      const TZ0 = -6.4, TZ1 = 1.6; // track lane extents
      const zs = [];
      for (const z of [-140, -100, -75, -55, -40, -30, -22, -16, -12, -10, -8.6, -7.6, -7.0]) zs.push(z);
      for (let z = TZ0; z <= TZ1 + 1e-6; z += 0.4) zs.push(+z.toFixed(2));
      for (const z of [2.2, 2.9, 3.8, 5, 7, 10, 14, 20]) zs.push(z);
      this.worldH = (x, z) => {
        const h = track.heightAt(x);
        if (z >= TZ0 && z <= TZ1) return h + (z > TZ1 - 0.6 || z < TZ0 + 0.6 ? 0.05 : 0);
        const front = z > TZ1;
        const dz = front ? z - TZ1 : TZ0 - z;
        const t = MX.math.smooth(clamp(dz / (front ? 2.4 : 6), 0, 1));
        // camera side drops away to a low, smooth baseline so jumps never block the view
        const bl = front ? Math.min(bAt(x), h, track.heightAt(x - 15), track.heightAt(x + 15)) - 0.6 - clamp(dz - 3, 0, 6) * 0.25 : Math.min(bAt(x), h) - 0.25;
        const far = clamp((dz - 10) / 80, 0, 1);
        let y = lerp(h, bl, t) + noise(x, z) * (front ? 0.3 : 0.5 + far * 14) * t;
        if (dz < 1.3) y += Math.sin(dz / 1.3 * Math.PI) * 0.22; // berm pushed off the track
        return y;
      };
      const mats = new T.MeshStandardMaterial({ vertexColors: true, roughness: th.wet ? 0.55 : 0.97, metalness: 0 });
      const tex = makeGroundTextures(5);
      mats.map = tex.map; mats.normalMap = tex.normal; mats.normalScale = new T.Vector2(0.9, 0.9);
      const CH = 160; // chunk length
      const xStart = track.x0 + 2, xEnd = track.xEnd - 2;
      const dx = 0.5;
      const lanes = [0, -1.6, -3.2, -4.8];
      for (let cx = xStart; cx < xEnd; cx += CH) {
        const cols = Math.ceil(Math.min(CH, xEnd - cx) / dx) + 1;
        const rows = zs.length;
        const pos = new Float32Array(cols * rows * 3), col = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2);
        for (let i = 0; i < cols; i++) {
          const x = cx + i * dx;
          const sf = MX.SURFACES[track.surfaceAt(x)] || MX.SURFACES.dirt;
          for (let j = 0; j < rows; j++) {
            const z = zs[j], k = i * rows + j;
            const y = this.worldH(x, z);
            pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
            uv[k * 2] = x / 3; uv[k * 2 + 1] = z / 3;
            let c;
            if (z >= TZ0 - 0.4 && z <= TZ1 + 0.4) {
              c = sf.color.slice();
              // ruts along the racing lines + groomed variation
              let rut = 0; for (const lz of lanes) rut += Math.exp(-((z - lz) * (z - lz)) / 0.08);
              const v = 1 - rut * 0.18 + (r() - 0.5) * 0.06 + noise(x * 3, z * 3) * 0.25;
              c = [c[0] * v, c[1] * v, c[2] * v];
            } else {
              const dz = z < TZ0 ? TZ0 - z : z - TZ1;
              const t = clamp((dz - 0.4) / 2.5, 0, 1);
              const gn = noise(x * 0.5, z * 0.5) + 0.5;
              const grass = [lerp(th.grass[0], th.grass2[0], gn), lerp(th.grass[1], th.grass2[1], gn), lerp(th.grass[2], th.grass2[2], gn)];
              const dirt = sf.color;
              c = [lerp(dirt[0], grass[0], t), lerp(dirt[1], grass[1], t), lerp(dirt[2], grass[2], t)];
            }
            col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
          }
        }
        const idx = [];
        for (let i = 0; i < cols - 1; i++) for (let j = 0; j < rows - 1; j++) {
          const a = i * rows + j, b = (i + 1) * rows + j, c2 = (i + 1) * rows + j + 1, d = i * rows + j + 1;
          idx.push(a, d, b, b, d, c2);
        }
        const geo = new T.BufferGeometry();
        geo.setAttribute('position', new T.BufferAttribute(pos, 3));
        geo.setAttribute('color', new T.BufferAttribute(col, 3));
        geo.setAttribute('uv', new T.BufferAttribute(uv, 2));
        geo.setIndex(idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
        const mesh = new T.Mesh(geo, mats); mesh.receiveShadow = true;
        this.scene.add(mesh);
      }
      // huge far ground plane so the horizon never shows a gap
      const fg = new T.Mesh(new T.PlaneGeometry(6000, 3000), new T.MeshStandardMaterial({ color: new T.Color(...th.grass).multiplyScalar(0.9), roughness: 1 }));
      fg.rotation.x = -Math.PI / 2; fg.position.set((track.x0 + track.xEnd) / 2, Math.min(...Array.from(base).filter((_, i) => i % 50 === 0)) - 6, -900);
      this.scene.add(fg);
    }

    buildBackdrop(track, th, level) {
      const scene = this.scene, r = rng(level.id.length * 99 + 7);
      const x0 = track.x0 - 400, x1 = track.xEnd + 400;
      // mountain ranges
      if (th.mountains) {
        th.mountains.forEach((c, li) => {
          const z = -380 - li * 260, H = (li ? 150 : 90) * (th.mesas ? 0.8 : 1);
          const pts = [], n = 160, ph = r() * 10;
          for (let i = 0; i <= n; i++) {
            const x = lerp(x0 - 800, x1 + 800, i / n);
            let y = (Math.sin(x * 0.004 + ph) * 0.5 + Math.sin(x * 0.011 + ph * 2) * 0.3 + Math.sin(x * 0.027 + ph) * 0.2) * 0.5 + 0.5;
            if (th.mesas) y = Math.min(0.62, y) * 1.2 + (y > 0.62 ? 0.02 : 0);
            pts.push([x, y * H + 10]);
          }
          const pos = [], idx = [];
          pts.forEach(([x, y], i) => { pos.push(x, -60, z, x, y, z); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
          const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
          const m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: c, roughness: 1, fog: true }));
          scene.add(m);
        });
      }
      // quarry cliffs: displaced rock walls with strata
      if (th.cliffs) {
        const cn = valueNoise(128, 5, 31);
        const nf = (u, v) => { const i = ((Math.floor(u) % 128) + 128) % 128, j = ((Math.floor(v) % 128) + 128) % 128; return cn[j * 128 + i] - 0.5; };
        const cols = 420, rows = 26, X0 = track.x0 - 200, X1 = track.xEnd + 200;
        const pos = [], col = [], idx = [];
        const base = new T.Color(th.cliffs), dark = base.clone().multiplyScalar(0.62), light = base.clone().lerp(new T.Color(0xf0d0b0), 0.25);
        for (let i = 0; i < cols; i++) {
          const x = lerp(X0, X1, i / (cols - 1));
          const top = 34 + nf(x * 0.05, 3) * 40 + nf(x * 0.2, 9) * 10;
          for (let j = 0; j < rows; j++) {
            const v = j / (rows - 1), y = -8 + v * top;
            const z = -78 - v * 10 + nf(x * 0.3, y * 0.3) * 6 + (Math.round(v * 6) % 2 ? 1.2 : 0) + nf(x * 0.05, 40) * 14;
            pos.push(x, y + this.worldH(x, -70) * 0.4, z);
            const strata = 0.5 + 0.5 * Math.sin(y * 0.9 + nf(x * 0.1, 7) * 4);
            const c = dark.clone().lerp(light, clamp(strata * 0.7 + nf(x, y) * 0.8 + v * 0.2, 0, 1));
            col.push(c.r, c.g, c.b);
            if (i && j) { const a = (i - 1) * rows + j - 1, b = i * rows + j - 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
          }
        }
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new T.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
        const wall = new T.Mesh(g, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
        wall.receiveShadow = true; scene.add(wall);
      }
      // trees / vegetation
      const kind = th.trees;
      if (kind && kind !== 'none') {
        const count = kind === 'forest' ? 2600 : kind === 'mixed' ? 1100 : kind === 'desert' ? 500 : 300;
        const trunkG = new T.CylinderGeometry(0.12, 0.2, 1, 6); trunkG.translate(0, 0.5, 0);
        const pineG = new T.ConeGeometry(1, 1, 8); pineG.translate(0, 0.5, 0);
        const roundG = new T.IcosahedronGeometry(1, 1);
        const cactusG = new T.CapsuleGeometry(0.22, 1, 4, 8); cactusG.translate(0, 0.7, 0);
        const rockG = new T.DodecahedronGeometry(1, 0);
        const trunks = new T.InstancedMesh(trunkG, mat(0x4a3424, 0.95), count);
        const leafM = mat(kind === 'desert' ? 0x6c8a3a : 0x2f4a22, 0.9);
        // three foliage layers per tree: stacked cones for conifers, clustered blobs for broadleaf
        const layerG = kind === 'desert' ? cactusG : pineG;
        const leaves = [0, 1, 2].map(() => new T.InstancedMesh(layerG, leafM, count));
        const blobs = [0, 1, 2].map(() => new T.InstancedMesh(roundG, leafM, count));
        const rocks = new T.InstancedMesh(rockG, mat(th.cliffs || 0x7a746a, 0.95), 400);
        const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), cc = new T.Color();
        const zero = new T.Matrix4().makeScale(0, 0, 0);
        let n = 0;
        for (let i = 0; i < count * 3 && n < count; i++) {
          const x = lerp(track.x0 - 50, track.xEnd + 50, r());
          const z = -(22 + Math.pow(r(), 0.7) * 130);
          const y = this.worldH(x, z);
          const hgt = kind === 'desert' ? 1.5 + r() * 2.5 : kind === 'sparse' ? 1.2 + r() * 2.2 : 7 + r() * 13;
          const broad = (kind === 'mixed' && r() < 0.55) || kind === 'sparse';
          cc.setHSL(kind === 'desert' ? 0.25 : (broad ? 0.24 : 0.3) + (r() - 0.5) * 0.06, 0.35 + r() * 0.2, (broad ? 0.22 : 0.15) + r() * 0.1);
          if (kind === 'desert') {
            trunks.setMatrixAt(n, zero);
            p.set(x, y - 0.2, z); s.set(1, hgt, 1); m4.compose(p, q.identity(), s); leaves[0].setMatrixAt(n, m4);
            for (let k = 1; k < 3; k++) {
              const arm = r() < 0.6; p.set(x + (k === 1 ? 0.35 : -0.35), y + hgt * (0.35 + r() * 0.2), z); s.set(0.7, arm ? hgt * 0.35 : 0, 0.7); m4.compose(p, q, s); leaves[k].setMatrixAt(n, m4);
            }
            for (const b of blobs) b.setMatrixAt(n, zero);
          } else if (broad) {
            p.set(x, y - 0.2, z); s.set(1.2, hgt * 0.55, 1.2); m4.compose(p, q.identity(), s); trunks.setMatrixAt(n, m4);
            for (let k = 0; k < 3; k++) {
              const rad = hgt * (0.22 + r() * 0.08);
              p.set(x + (k - 1) * hgt * 0.16, y + hgt * (0.55 + (k === 1 ? 0.15 : 0)), z + (r() - 0.5) * hgt * 0.2);
              s.set(rad, rad * 0.85, rad); m4.compose(p, q, s); blobs[k].setMatrixAt(n, m4); blobs[k].setColorAt(n, cc);
            }
            for (const l of leaves) l.setMatrixAt(n, zero);
          } else {
            p.set(x, y - 0.2, z); s.set(1, hgt * 0.35, 1); m4.compose(p, q.identity(), s); trunks.setMatrixAt(n, m4);
            for (let k = 0; k < 3; k++) {
              const w = hgt * [0.24, 0.18, 0.12][k], hh = hgt * [0.42, 0.36, 0.3][k];
              p.set(x, y + hgt * [0.18, 0.4, 0.62][k], z); s.set(w, hh, w); m4.compose(p, q, s); leaves[k].setMatrixAt(n, m4);
            }
            for (const b of blobs) b.setMatrixAt(n, zero);
          }
          for (const l of leaves) l.setColorAt(n, cc);
          for (const b of blobs) b.setColorAt(n, cc);
          n++;
        }
        trunks.count = n; for (const l of [...leaves, ...blobs]) { l.count = n; l.castShadow = true; scene.add(l); }
        for (let i = 0; i < 400; i++) {
          const front = r() < 0.3, x = lerp(track.x0, track.xEnd, r()), z = front ? 3.6 + r() * 4 : -(10 + r() * 40), sz = front ? 0.08 + r() * 0.25 : 0.2 + Math.pow(r(), 3) * 1.8;
          q.setFromEuler(new T.Euler(r() * 3, r() * 3, r() * 3)); p.set(x, this.worldH(x, z), z); s.set(sz, sz * 0.7, sz); m4.compose(p, q, s); rocks.setMatrixAt(i, m4);
        }
        for (const im of [trunks, rocks]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
      }
      if (th.stadium) this.buildStadium(track);
    }

    buildStadium(track) {
      const scene = this.scene, r = rng(42);
      const x0 = track.x0 + 20, x1 = track.xEnd - 20;
      const standM = mat(0x30343c, 0.9);
      const tiers = 14;
      for (let t = 0; t < tiers; t++) {
        const g = new T.Mesh(new T.BoxGeometry(x1 - x0, 0.9, 1.6), standM);
        g.position.set((x0 + x1) / 2, 1.5 + t * 0.9, -26 - t * 1.6); g.receiveShadow = true; scene.add(g);
      }
      // crowd
      const N = 9000, crowd = new T.InstancedMesh(new T.CapsuleGeometry(0.2, 0.4, 2, 6), new T.MeshStandardMaterial({ roughness: 0.9 }), N);
      const m4 = new T.Matrix4(), cc = new T.Color();
      for (let i = 0; i < N; i++) {
        const t = Math.floor(r() * tiers), x = lerp(x0, x1, r());
        m4.makeTranslation(x, 2.3 + t * 0.9, -26 - t * 1.6 + (r() - 0.5) * 0.4);
        crowd.setMatrixAt(i, m4);
        cc.setHSL(r(), 0.25 + r() * 0.35, 0.12 + r() * 0.3); crowd.setColorAt(i, cc);
      }
      scene.add(crowd); this.crowd = crowd;
      // wall + banners in front of stands
      const wall = new T.Mesh(new T.BoxGeometry(x1 - x0, 2.2, 0.3), mat(0x1a1d24, 0.6)); wall.position.set((x0 + x1) / 2, 1.1, -24.5); scene.add(wall);
      const names = ['TORQUE', 'APEX OIL', 'GRITLINE', 'HOLESHOT', 'RIDGEBACK', 'NITRO TYRES'];
      for (let x = x0, i = 0; x < x1; x += 14, i++) {
        const b = new T.Mesh(new T.PlaneGeometry(13, 1.6), new T.MeshStandardMaterial({ map: textTexture(names[i % names.length], { bg: ['#d81e1e', '#1e5bd8', '#f2c200', '#111'][i % 4], fg: i % 4 === 2 ? '#111' : '#fff', size: 80, w: 512, h: 64 }), emissive: 0xffffff, emissiveIntensity: 0.25 }));
        b.position.set(x + 6.5, 1.2, -24.3); scene.add(b);
        if (b.material.emissiveMap === null) b.material.emissiveMap = b.material.map;
      }
      // light towers
      const lampM = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 3 });
      for (let x = x0; x < x1; x += 60) {
        const pole = new T.Mesh(new T.CylinderGeometry(0.4, 0.6, 40, 8), mat(0x555555, 0.6, 0.5)); pole.position.set(x, 20, -52); scene.add(pole);
        const panel = new T.Mesh(new T.BoxGeometry(8, 4, 0.5), lampM); panel.position.set(x, 41, -51.5); panel.rotation.x = 0.4; scene.add(panel);
      }
      // roof edge
      const roof = new T.Mesh(new T.BoxGeometry(x1 - x0, 1.2, 30), mat(0x15171c, 0.8)); roof.position.set((x0 + x1) / 2, 30, -40); scene.add(roof);
    }

    buildProps(track, th, level) {
      const scene = this.scene, r = rng(9);
      // course tape posts + tape both sides
      const postG = new T.CylinderGeometry(0.025, 0.025, 1, 6); postG.translate(0, 0.5, 0);
      const posts = new T.InstancedMesh(postG, mat(0xe8e8e8, 0.6), 2000);
      const m4 = new T.Matrix4(); let n = 0;
      const tapes = { [-8.2]: [], [2.6]: [] };
      for (let x = track.x0 + 30; x < track.xEnd - 20 && n < 1998; x += 4) {
        for (const z of [-8.2, 2.6]) {
          const y = this.worldH(x, z); m4.makeTranslation(x, y, z); posts.setMatrixAt(n++, m4);
          tapes[z].push([x, y + 0.85, z]);
        }
      }
      posts.count = n; posts.castShadow = true; scene.add(posts);
      for (const z in tapes) {
        const p = tapes[z], pos = [], idx = [];
        p.forEach(([x, y, zz], i) => { pos.push(x, y, zz, x, y + 0.07, zz); if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); } });
        const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        scene.add(new T.Mesh(g, new T.MeshStandardMaterial({ color: th.stadium ? 0x3399ff : 0xff3a1a, side: T.DoubleSide, roughness: 0.6 })));
      }
      // tuff blocks / hay bales at jump faces (camera side)
      const baleG = new T.CylinderGeometry(0.42, 0.42, 0.95, 16); baleG.rotateX(Math.PI / 2);
      const baleM = th.stadium ? mat(0x1b5fd0, 0.8) : mat(0xc9a64a, 1.0);
      const bales = new T.InstancedMesh(baleG, baleM, 300); n = 0;
      for (const j of track.jumps) {
        for (const off of [-6, -2]) {
          if (n >= 300) break;
          const x = j.lipX + off, z = -7.4; m4.makeTranslation(x, this.worldH(x, z) + 0.4, z); bales.setMatrixAt(n++, m4);
        }
      }
      bales.count = n; bales.castShadow = true; bales.receiveShadow = true; scene.add(bales);
      // banners along the back
      if (!th.stadium) {
        const names = ['TORQUE', 'APEX OIL', 'GRITLINE', 'HOLESHOT', 'RIDGEBACK', 'NITRO TYRES', 'MUDHOUND'];
        for (let x = track.x0 + 40, i = 0; x < track.xEnd - 40; x += 55 + r() * 40, i++) {
          const y = this.worldH(x, -9.5);
          const tex = textTexture(names[i % names.length], { bg: ['#d81e1e', '#1e5bd8', '#f2c200', '#111', '#17a34a'][i % 5], fg: i % 5 === 2 ? '#111' : '#fff', size: 72, w: 512, h: 96 });
          const b = new T.Mesh(new T.PlaneGeometry(6, 1.1), new T.MeshStandardMaterial({ map: tex, roughness: 0.7, side: T.DoubleSide }));
          b.position.set(x, y + 0.75, -9.5); b.castShadow = true; scene.add(b);
          for (const dx of [-3, 3]) { const p = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 1.4, 6), mat(0x888888, 0.5, 0.6)); p.position.set(x + dx, y + 0.7, -9.52); scene.add(p); }
        }
      }
      // start gate
      const gx = track.startX - 1.7;
      const gateM = mat(0x9aa0a8, 0.4, 0.7);
      this.gates = [];
      for (const lz of [0, -1.6, -3.2, -4.8]) {
        const gy = this.worldH(gx, lz);
        const plate = new T.Mesh(new T.BoxGeometry(0.06, 0.55, 1.3), gateM); plate.geometry.translate(0, 0.275, 0);
        plate.position.set(gx, gy, lz); plate.castShadow = true; scene.add(plate); this.gates.push(plate);
      }
      const beam = new T.Mesh(new T.BoxGeometry(0.5, 0.15, 7.5), mat(0x2a2a2a, 0.6, 0.4)); beam.position.set(gx - 0.4, this.worldH(gx, 0) + 0.08, -2.4); scene.add(beam);
      // finish arch with checkered banner
      const fx = track.finishX, fy = this.worldH(fx, 0);
      const chk = new T.MeshStandardMaterial({ map: checkerTexture(), side: T.DoubleSide, roughness: 0.7 });
      const ban = new T.Mesh(new T.PlaneGeometry(10.5, 1.4), chk); ban.position.set(fx, fy + 5.2, -2.4); ban.rotation.y = Math.PI / 2; scene.add(ban);
      for (const z of [2.8, -7.6]) { const p = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 6, 10), mat(0xdddddd, 0.4, 0.6)); p.position.set(fx, fy + 3, z); p.castShadow = true; scene.add(p); }
      const fl = new T.Mesh(new T.PlaneGeometry(0.4, 4), chk); fl.position.set(fx, fy + 0.02, -2.4); fl.rotation.x = -Math.PI / 2; scene.add(fl);
      // checkpoint flags
      const flagM = new T.MeshStandardMaterial({ color: 0x18c040, side: T.DoubleSide, roughness: 0.7 });
      for (const cx of track.checkpoints) {
        const y = this.worldH(cx, 2.9);
        const pole = new T.Mesh(new T.CylinderGeometry(0.03, 0.03, 2.2, 6), mat(0xffffff, 0.5)); pole.position.set(cx, y + 1.1, 2.9); scene.add(pole);
        const f = new T.Mesh(new T.PlaneGeometry(0.7, 0.45), flagM); f.position.set(cx + 0.35, y + 1.95, 2.9); scene.add(f);
      }
      // freestyle: distance boards on the landings
      if (level.mode === 'freestyle') {
        for (const j of track.jumps) {
          const x = j.lipX + j.gap, y = this.worldH(x, -7.6);
          const b = new T.Mesh(new T.PlaneGeometry(1.6, 0.8), new T.MeshStandardMaterial({ map: textTexture(Math.round(j.gap) + 'm', { bg: '#111', fg: '#ffd400', size: 80 }), roughness: 0.6 }));
          b.position.set(x, y + 1.4, -7.6); scene.add(b);
        }
      }
    }

    buildRain() {
      const N = 2500, pos = new Float32Array(N * 6);
      this.rainData = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { this.rainData[i * 3] = (Math.random() - 0.5) * 60; this.rainData[i * 3 + 1] = Math.random() * 30; this.rainData[i * 3 + 2] = -20 + Math.random() * 34; }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      this.rain = new T.LineSegments(g, new T.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.45 }));
      this.rain.frustumCulled = false; this.scene.add(this.rain);
    }

    addBike(bike, color, num, laneZ) {
      const bm = buildBike(color, num), rm = buildRider(color, num);
      this.scene.add(bm.root, rm.root);
      const v = { bike, bm, rm, laneZ, emitAcc: 0 };
      this.bikes.push(v);
      return v;
    }

    emitFor(v, dt) {
      const b = v.bike, P = this.particles, th = this.theme;
      const z0 = v.laneZ;
      for (let i = 0; i < 2; i++) {
        const w = b.wheels[i];
        if (!w.ground) continue;
        const sf = MX.SURFACES[w.surf] || MX.SURFACES.dirt;
        const wet = w.surf === 'mud' || th.wet;
        const r = MX.GEO.wheelR[i];
        const cx = w.x - w.nx * r, cy = w.y - w.ny * r;
        const spd = Math.abs(w.w * r);
        // roost: rear wheel driving / spinning
        if (i === 0) {
          const drive = clamp(b.engineTorqueOut / 900, 0, 1.2) + clamp(Math.abs(w.slip) / 4, 0, 1);
          const rate = (drive * 140 + spd * 2) * dt * (this.quality === 'low' ? 0.4 : 1);
          v.emitAcc += rate;
          while (v.emitAcc >= 1) {
            v.emitAcc -= 1;
            const s = 3 + Math.random() * 6 + spd * 0.25;
            const ang = 0.35 + Math.random() * 0.6;
            const c = wet ? sf.dust.map((k) => k * (0.8 + Math.random() * 0.3)) : sf.color.map((k) => k * (0.85 + Math.random() * 0.4));
            P.emit(cx - 0.05, cy + 0.04, z0 + (Math.random() - 0.5) * 0.25, b.vx * 0.3 - Math.cos(ang) * s, Math.sin(ang) * s, (Math.random() - 0.5) * 2.5,
              0.5 + Math.random() * 0.6, wet ? 0.06 + Math.random() * 0.06 : 0.04 + Math.random() * 0.05, 0, c, 1, 9.81, 0.5);
            if (!wet && Math.random() < 0.35) {
              P.emit(cx - 0.3, cy + 0.15, z0 + (Math.random() - 0.5) * 0.6, b.vx * 0.2 - 1 - Math.random() * 2, 0.5 + Math.random() * 1.2, (Math.random() - 0.3) * 1.2,
                1.6 + Math.random() * 1.8, 0.35 + Math.random() * 0.3, 1.1, sf.dust, 0.22, 0.15, 1.2);
            }
          }
        }
        // landing impact burst
        if (w.contact > 4 && !w._burst) {
          w._burst = true;
          const n = Math.min(60, w.contact * 5);
          for (let k = 0; k < n; k++) {
            const a = Math.random() * Math.PI, s = 1 + Math.random() * w.contact * 0.35;
            if (wet) P.emit(cx, cy + 0.05, z0 + (Math.random() - 0.5) * 0.5, Math.cos(a) * s + b.vx * 0.3, Math.sin(a) * s * 0.8, (Math.random() - 0.5) * 3, 0.6 + Math.random() * 0.4, 0.07, 0, sf.dust, 1, 9.81, 0.3);
            else P.emit(cx, cy + 0.1, z0 + (Math.random() - 0.5) * 0.8, Math.cos(a) * s * 0.6 + b.vx * 0.2, Math.random() * 1.2, (Math.random() - 0.5) * 2, 1.5 + Math.random() * 1.5, 0.4 + Math.random() * 0.4, 1.2, sf.dust, 0.3, 0.1, 1.5);
          }
        }
        if (w.contact < 1) w._burst = false;
      }
      for (const w of b.wheels) if (!w.ground) w._burst = false;
      // exhaust haze
      if (!b.crashed && Math.random() < b.throttle * 0.5) {
        const p = b.localToWorld(-0.82, -0.02);
        P.emit(p[0], p[1], z0 - 0.14, b.vx * 0.6 - 1.5, 0.3, -0.3, 0.6, 0.12, 0.8, [0.55, 0.55, 0.58], 0.12, -0.2, 2);
      }
    }

    update(dt, focus, t) {
      // models
      for (const v of this.bikes) {
        updateBikeModel(v.bm, v.bike, v.laneZ);
        updateRider(v.rm, v.bike.skelWorld(), v.laneZ, v.bike.a);
        if (dt > 0) this.emitFor(v, dt);
      }
      this.particles.update(dt, (x) => this.track.heightAt(x));
      // camera
      const b = focus.bike;
      const tx = b.crashed && b.ragdoll ? b.ragdoll.p.hip[0] : b.x, ty = b.crashed && b.ragdoll ? b.ragdoll.p.hip[1] : b.y;
      const spd = Math.hypot(b.vx, b.vy);
      const ahead = clamp(b.vx * 0.45, -4, 9);
      const groundY = this.track.heightAt(tx + ahead);
      const want = new T.Vector3(tx + ahead * 0.55, Math.max(ty, groundY + 1) + 1.0 + clamp(spd * 0.025, 0, 0.8), focus.laneZ + 8.2 + clamp(spd * 0.14, 0, 4.5));
      const look = new T.Vector3(tx + ahead, lerp(ty, groundY + 1, 0.3) + 0.3, focus.laneZ - 1.2);
      if (!this.camInit) { this.camPos.copy(want); this.camLook.copy(look); this.camInit = true; }
      const k = 1 - Math.exp(-dt * 4.5), kl = 1 - Math.exp(-dt * 6);
      this.camPos.lerp(want, k); this.camLook.lerp(look, kl);
      this.camera.position.copy(this.camPos);
      if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake; this.camera.position.y += (Math.random() - 0.5) * this.shake; this.shake = Math.max(0, this.shake - dt * 1.5); }
      this.camera.lookAt(this.camLook);
      // sun follows (shadow frustum around focus)
      this.sun.position.set(tx + this.sunDir.x * 60, ty + this.sunDir.y * 60, focus.laneZ + this.sunDir.z * 60);
      this.sun.target.position.set(tx + 4, ty - 1, focus.laneZ - 2);
      this.sky.position.copy(this.camera.position);
      // rain
      if (this.rain) {
        const pos = this.rain.geometry.attributes.position.array, d = this.rainData;
        for (let i = 0; i < d.length / 3; i++) {
          d[i * 3 + 1] -= 22 * dt; d[i * 3] -= 3 * dt;
          if (d[i * 3 + 1] < -2) { d[i * 3 + 1] += 30; d[i * 3] = (Math.random() - 0.5) * 60; }
          const x = this.camPos.x + d[i * 3], y = this.camPos.y - 8 + d[i * 3 + 1], z = d[i * 3 + 2];
          pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x + 0.08; pos[i * 6 + 4] = y + 0.55; pos[i * 6 + 5] = z;
        }
        this.rain.geometry.attributes.position.needsUpdate = true;
      }
      if (this.crowd && t != null) this.crowd.position.y = Math.abs(Math.sin(t * 7)) * 0.04;
    }
    dropGates(t) { if (this.gates) for (const g of this.gates) g.rotation.z = -Math.min(1, t * 3) * Math.PI / 2 * 0.95; }
    render() { this.gl.render(this.scene, this.camera); }
  }
  MX.Renderer = Renderer;
})(window);

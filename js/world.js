// Procedural archipelago: terrain, vegetation, harbours, lighthouses, beacons, wrecks
import * as THREE from 'three';
import { ISLANDS, WORLD_SIZE, HEIGHTMAP_RES, SEA_FLOOR } from './config.js';
import { TAU, DEG, clamp, lerp, smoothstep, fbm, ridged, noise2, mulberry32, mergeGeos, paint, box, cyl, place } from './util.js';

// ---------- terrain height ----------
function islandHeight(I, x, z) {
  const dx = x - I.x, dz = z - I.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d > I.r * 1.75) return SEA_FLOOR;
  const s = I.seed * 13.7;
  const w = fbm(dx / (I.r * 0.6) + s, dz / (I.r * 0.6) - s, 4);
  const rr = d / (I.r * (0.70 + 0.6 * w));
  const base = 1 - rr;
  const under = (b, shelf = 1.6) => SEA_FLOOR * (1 - Math.exp(b * shelf));
  let h;
  switch (I.type) {
    case 'atoll': {
      const ring = Math.exp(-Math.pow((rr - 0.74) / 0.15, 2));
      if (rr < 0.74) h = ring * (I.H + 3.2) - 3.2 + (fbm(x / 30, z / 30, 2) - 0.5) * 1.2 * ring;
      else h = ring * (I.H - SEA_FLOOR) + SEA_FLOOR;
      // a pass through the reef on the south-east side
      const ang = Math.atan2(dx, -dz), gap = Math.exp(-Math.pow((ang - 2.3) / 0.16, 2));
      h = lerp(h, Math.min(h, -4.5), gap * smoothstep(0.4, 0.6, rr));
      return h;
    }
    case 'stacks': {
      const n = fbm(x / 85 + s, z / 85 + s * 0.3, 4);
      const mask = smoothstep(-0.05, 0.35, base);
      const v = (n - 0.56) * mask + Math.min(base, 0) * 0.5;
      if (v > 0) {
        const t = Math.min(v / 0.2, 1);
        h = I.sandy ? I.H * Math.pow(t, 0.9) : I.H * (Math.pow(t, 0.55) * 0.75 + t * 0.25) * (0.6 + 0.8 * noise2(x / 40 + s, z / 40));
        if (!I.sandy) h = Math.max(h, t * 3);
      } else h = Math.max(SEA_FLOOR, v * (I.sandy ? 55 : 150));
      return h;
    }
    case 'volcano':
    case 'peak': {
      if (base <= 0) return under(base);
      const rd = ridged(x / 160 + s, z / 160 - s, 5);
      const cone = Math.pow(base, 1.75);
      h = I.H * cone * (0.72 + 0.5 * rd) + base * 14 * fbm(x / 60, z / 60, 3);
      if (I.type === 'volcano') {
        const dc = d / I.r;
        h -= smoothstep(0.16, 0.0, dc) * I.H * 0.2;
      }
      return h * smoothstep(0, 0.06, base) + base * 4;
    }
    case 'cliffs': {
      if (base <= 0) return under(base, 2.6);
      const plateau = smoothstep(0.03, 0.13, base);
      const n = fbm(x / 110 + s, z / 110, 4);
      h = base * 9 + plateau * I.H * (0.45 + 0.75 * n) * (0.6 + 0.4 * smoothstep(0.1, 0.5, base));
      return h;
    }
    case 'cay': {
      if (base <= 0) return under(base, 1.2);
      const n = fbm(x / 55 + s, z / 55, 3);
      return I.H * Math.pow(base, 1.1) * (0.55 + 0.9 * n) * 1.25 * smoothstep(0, 0.2, base) + base * 2.2;
    }
    default: { // hills
      if (base <= 0) return under(base);
      const n = fbm(x / 120 + s, z / 120 - s, 5);
      const r2 = ridged(x / 260 + s, z / 260, 3);
      return I.H * Math.pow(base, 1.3) * (0.35 + 0.85 * n + 0.45 * r2) + base * 3;
    }
  }
}

function terrainExact(x, z) {
  let h = SEA_FLOOR;
  for (const I of ISLANDS) {
    const dx = x - I.x, dz = z - I.z, lim = I.r * 1.75;
    if (dx > lim || dx < -lim || dz > lim || dz < -lim) continue;
    const v = islandHeight(I, x, z);
    if (v > h) h = v;
  }
  return h;
}

// ---------- palette ----------
const P = {
  sand: new THREE.Color(0xe6d3a0), wet: new THREE.Color(0xb39c6d), seabed: new THREE.Color(0x8fa67e),
  grassA: new THREE.Color(0x5d8a34), grassB: new THREE.Color(0x3d6b2a), grassDry: new THREE.Color(0x9a9a4e),
  jungle: new THREE.Color(0x3f8236), rock: new THREE.Color(0x78716a), rockDark: new THREE.Color(0x4a4648),
  basalt: new THREE.Color(0x35313a), ember: new THREE.Color(0x6b2c1e), snow: new THREE.Color(0xf2f5fa),
  pineFloor: new THREE.Color(0x35552f),
};
const _col = new THREE.Color();
function terrainColor(I, h, slope, n, n2, out) {
  const tropical = I.type === 'cay' || I.type === 'atoll' || I.sandy;
  if (h < 0.25) {
    out.copy(P.wet).lerp(P.seabed, smoothstep(0, -6, h)).multiplyScalar(lerp(1, 0.55, smoothstep(-3, -20, h)));
    return;
  }
  const beachTop = (tropical ? 3.6 : 1.9) + n * 1.6;
  if (h < beachTop && slope < 0.35) {
    out.copy(P.wet).lerp(P.sand, smoothstep(0.25, 1.1, h));
    out.lerp(P.grassDry, smoothstep(beachTop - 1.0, beachTop, h) * 0.6);
    return;
  }
  // grass
  if (tropical) out.copy(P.jungle).lerp(P.grassDry, n2 * 0.6);
  else if (I.trees === 'pine') out.copy(P.pineFloor).lerp(P.grassA, n2 * 0.7);
  else out.copy(P.grassB).lerp(P.grassA, n2);
  out.lerp(P.grassDry, smoothstep(0.55, 0.9, n) * 0.35);
  const hn = h / I.H;
  if (I.type === 'volcano') {
    out.lerp(P.basalt, smoothstep(0.28, 0.5, hn + n * 0.15));
    out.lerp(P.ember, smoothstep(0.78, 1.0, hn) * 0.7);
  }
  if (I.type === 'peak') out.lerp(P.rock, smoothstep(0.25, 0.45, hn + n * 0.1));
  if (I.type === 'stacks' && !I.sandy) out.lerp(P.rockDark, 0.55 + 0.3 * n);
  // rock on steep ground
  const rockAmt = smoothstep(0.16, 0.34, slope + (n2 - 0.5) * 0.08);
  _col.copy(I.type === 'volcano' || I.type === 'stacks' ? P.rockDark : P.rock).lerp(P.rockDark, n * 0.5);
  out.lerp(_col, rockAmt);
  if (I.snow) out.lerp(P.snow, smoothstep(0.5, 0.62, hn + (n - 0.5) * 0.2) * (1 - rockAmt * 0.5));
}

// ---------- shared decoration geometry ----------
let GEO = null;
function buildDecorGeos() {
  if (GEO) return GEO;
  const palmParts = [];
  const trunk = new THREE.CylinderGeometry(0.13, 0.25, 7, 6, 6); trunk.translate(0, 3.5, 0);
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + Math.pow(y / 7, 2) * 1.3); }
  palmParts.push(paint(trunk, 0x8a6a45));
  for (let k = 0; k < 9; k++) {
    const f = new THREE.PlaneGeometry(1.1, 3.8, 2, 5); f.translate(0, 1.9, 0); f.rotateX(Math.PI / 2);
    const fp = f.attributes.position;
    const lift = 0.4 + (k % 3) * 0.25;
    for (let i = 0; i < fp.count; i++) {
      const t = fp.getZ(i) / 3.8, x = fp.getX(i);
      fp.setY(i, lift * t * 2 - 2.3 * t * t - Math.abs(x) * 0.45);
      fp.setX(i, x * (1 - t * 0.75));
    }
    f.rotateY((k / 9) * TAU + (k % 2) * 0.2); f.translate(1.3, 6.95, 0);
    palmParts.push(paint(f, k % 2 ? 0x4c8a2e : 0x3c7426));
  }
  const pine = [paint(place(new THREE.CylinderGeometry(0.12, 0.22, 2.2, 5), 0, 1.1, 0), 0x5b432c)];
  [[1.9, 3.0, 2.6], [1.5, 2.6, 4.3], [1.05, 2.3, 5.9], [0.6, 1.8, 7.2]].forEach(([r, h, y], i) =>
    pine.push(paint(place(new THREE.ConeGeometry(r, h, 7), 0, y, 0, i * 0.5), i % 2 ? 0x24512f : 0x1d4528)));
  const leaf = [paint(place(new THREE.CylinderGeometry(0.16, 0.26, 2.6, 5), 0, 1.3, 0), 0x5e4630)];
  [[0, 3.6, 0, 1.9], [0.9, 3.0, 0.4, 1.3], [-0.8, 3.2, -0.5, 1.4], [0.1, 4.6, -0.2, 1.2]].forEach(([x, y, z, r], i) => {
    const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, 0.8, 1);
    leaf.push(paint(place(g, x, y, z), i % 2 ? 0x4a7d2c : 0x3d6c27));
  });
  const bush = new THREE.IcosahedronGeometry(1, 1); bush.scale(1, 0.62, 1); bush.translate(0, 0.35, 0);
  const rock = new THREE.IcosahedronGeometry(1, 1);
  const rp = rock.attributes.position, rr = mulberry32(5);
  const seen = new Map();
  for (let i = 0; i < rp.count; i++) {
    const key = rp.getX(i).toFixed(3) + rp.getY(i).toFixed(3) + rp.getZ(i).toFixed(3);
    if (!seen.has(key)) seen.set(key, 0.72 + rr() * 0.5);
    const s = seen.get(key);
    rp.setXYZ(i, rp.getX(i) * s, rp.getY(i) * s * 0.75, rp.getZ(i) * s);
  }
  rock.computeVertexNormals();
  GEO = { palm: mergeGeos(palmParts), pine: mergeGeos(pine), leaf: mergeGeos(leaf), bush: paint(bush, 0x4f7a30), rock: paint(rock, 0x8a847c) };
  GEO.bush.computeVertexNormals();
  return GEO;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)');
  gr.addColorStop(0.45, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class World {
  constructor(scene, noiseTex, quality = 2) {
    this.scene = scene;
    this.quality = quality;
    this.group = new THREE.Group(); scene.add(this.group);
    this.islands = [];
    this.byId = {};
    this.colliders = [];
    this.buoys = [];
    this.nightGlows = [];
    this.beams = [];
    this.night = 0;
    this.glowTex = glowTexture();
    this._buildHeightmap();
    const detail = noiseTex; // reuse tileable noise as albedo detail
    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0 });
    this.terrainMat.onBeforeCompile = (sh) => {
      sh.uniforms.uDetail = { value: detail };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uDetail;\nvarying vec3 vWp;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec4 dn = texture2D(uDetail, vWp.xz * 0.045);
          vec4 dn2 = texture2D(uDetail, vWp.xz * 0.006);
          diffuseColor.rgb *= 0.72 + 0.42 * dn.a + 0.22 * (dn2.g - 0.5) + 0.15 * (dn.b - 0.5);
          // darken wet sand at the waterline, tint underwater
          diffuseColor.rgb *= mix(1.0, 0.72, smoothstep(0.9, 0.0, vWp.y) * step(-0.5, vWp.y));`);
    };
    this.decorMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
    this.buildMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.windowMat = new THREE.MeshStandardMaterial({ color: 0x1c2a38, emissive: 0xffb45e, emissiveIntensity: 0, roughness: 0.3 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffd27a, emissiveIntensity: 0.4 });
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, uLen: { value: 420 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying float vT; varying vec3 vN; varying vec3 vV; uniform float uLen; void main(){ vT = length(position) / uLen; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying float vT; varying vec3 vN; varying vec3 vV; uniform float opacity; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0); float a = opacity * edge * pow(1.0 - clamp(vT, 0.0, 1.0), 1.6); gl_FragColor = vec4(vec3(1.0, 0.93, 0.7) * a, a); }',
    });
    for (const def of ISLANDS) this._buildIsland(def);
    this._extraBuoy();
  }

  // ----- heightmap (GPU texture + CPU sampler) -----
  _buildHeightmap() {
    const R = HEIGHTMAP_RES, data = new Float32Array(R * R).fill(SEA_FLOOR);
    const cell = WORLD_SIZE / R;
    for (const I of ISLANDS) {
      const lim = I.r * 1.75;
      const x0 = Math.max(0, Math.floor((I.x - lim + WORLD_SIZE / 2) / cell)), x1 = Math.min(R - 1, Math.ceil((I.x + lim + WORLD_SIZE / 2) / cell));
      const z0 = Math.max(0, Math.floor((I.z - lim + WORLD_SIZE / 2) / cell)), z1 = Math.min(R - 1, Math.ceil((I.z + lim + WORLD_SIZE / 2) / cell));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const h = islandHeight(I, (i + 0.5) * cell - WORLD_SIZE / 2, (j + 0.5) * cell - WORLD_SIZE / 2);
        if (h > data[j * R + i]) data[j * R + i] = h;
      }
    }
    this.heightData = data;
    const half = new Uint16Array(R * R), floorH = THREE.DataUtils.toHalfFloat(SEA_FLOOR);
    for (let i = 0; i < half.length; i++) half[i] = data[i] === SEA_FLOOR ? floorH : THREE.DataUtils.toHalfFloat(data[i]);
    const tex = new THREE.DataTexture(half, R, R, THREE.RedFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.heightTex = tex;
  }

  heightAt(x, z) {
    const R = HEIGHTMAP_RES;
    const fx = (x / WORLD_SIZE + 0.5) * R - 0.5, fz = (z / WORLD_SIZE + 0.5) * R - 0.5;
    if (fx < 0 || fz < 0 || fx >= R - 1 || fz >= R - 1) return SEA_FLOOR;
    const ix = fx | 0, iz = fz | 0, tx = fx - ix, tz = fz - iz, d = this.heightData, o = iz * R + ix;
    return (d[o] * (1 - tx) + d[o + 1] * tx) * (1 - tz) + (d[o + R] * (1 - tx) + d[o + R + 1] * tx) * tz;
  }
  heightExact(x, z) { return terrainExact(x, z); }

  _findShore(I, bearingDeg, level, from = 1.7) {
    const b = bearingDeg * DEG, dx = Math.sin(b), dz = -Math.cos(b);
    for (let d = I.r * from; d > 0; d -= 1.5) {
      const x = I.x + dx * d, z = I.z + dz * d;
      if (islandHeight(I, x, z) > level) return { x, z, d, dx, dz };
    }
    return { x: I.x, z: I.z, d: 0, dx, dz };
  }

  // ----- island construction -----
  _buildIsland(def) {
    const I = def, rand = mulberry32(I.seed * 977);
    const isl = { def, id: I.id, group: new THREE.Group(), decor: new THREE.Group(), lit: false, houses: [] };
    isl.group.add(isl.decor);
    this.group.add(isl.group);
    this.islands.push(isl); this.byId[I.id] = isl;

    // terrain mesh
    const side = I.r * 2.9, step = [11, 8, 6.2][this.quality];
    const N = clamp(Math.round(side / step), 48, 240), V = N + 1;
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const x = I.x - side / 2 + (i / N) * side, z = I.z - side / 2 + (j / N) * side, o = (j * V + i) * 3;
      pos[o] = x; pos[o + 1] = Math.max(islandHeight(I, x, z), -24); pos[o + 2] = z;
    }
    const idx = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      if (pos[a * 3 + 1] <= -23.9 && pos[b * 3 + 1] <= -23.9 && pos[c * 3 + 1] <= -23.9 && pos[d * 3 + 1] <= -23.9) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const nor = geo.attributes.normal.array, c = new THREE.Color();
    for (let k = 0; k < V * V; k++) {
      const x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
      terrainColor(I, h, 1 - nor[k * 3 + 1], fbm(x / 70 + 3, z / 70 + 9, 3), fbm(x / 19, z / 19, 2), c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mesh = new THREE.Mesh(geo, this.terrainMat);
    mesh.receiveShadow = true;
    isl.group.add(mesh);
    isl.terrain = mesh;

    const buildParts = [], windowParts = [], lampParts = [];
    if (I.harbour !== undefined) this._buildHarbour(isl, rand, buildParts, windowParts, lampParts);
    if (I.lighthouse !== undefined) this._buildLighthouse(isl, buildParts, lampParts);
    if (I.beacon !== undefined) this._buildBeacon(isl, buildParts);
    if (I.wreck !== undefined) this._buildWreck(isl, buildParts);
    if (I.gate) this._buildGate(isl, buildParts);
    if (buildParts.length) {
      const m = new THREE.Mesh(mergeGeos(buildParts), this.buildMat); m.castShadow = false; isl.group.add(m);
    }
    if (windowParts.length) isl.group.add(new THREE.Mesh(mergeGeos(windowParts), this.windowMat));
    if (lampParts.length) isl.group.add(new THREE.Mesh(mergeGeos(lampParts), this.lampMat));
    this._buildDecor(isl, rand);
  }

  _slopeOK(I, x, z, max = 0.35) {
    const h = islandHeight(I, x, z);
    return Math.abs(islandHeight(I, x + 3, z) - h) < max * 3 && Math.abs(islandHeight(I, x, z + 3) - h) < max * 3;
  }

  _buildDecor(isl, rand) {
    const I = isl.def; if (I.trees === 'none') return;
    const G = buildDecorGeos();
    const lists = { palm: [], pine: [], leaf: [], bush: [], rock: [] };
    const density = { palm: 1, pine: 1.25, mixed: 1.1, sparse: 0.18 }[I.trees] * [0.5, 0.8, 1][this.quality];
    const tries = Math.round(I.r * I.r * 0.011 * density);
    const treeLine = I.snow ? I.H * 0.5 : I.type === 'volcano' ? I.H * 0.36 : 1e9;
    for (let t = 0; t < tries; t++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * I.r * 1.25;
      const x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d;
      const h = islandHeight(I, x, z);
      if (h < 1.3) continue;
      let blocked = false;
      for (const hs of isl.houses) if ((hs.x - x) ** 2 + (hs.z - z) ** 2 < 70) { blocked = true; break; }
      if (blocked) continue;
      const clump = fbm(x / 45 + I.seed, z / 45, 2);
      const flat = this._slopeOK(I, x, z, 0.55);
      const r = rand();
      let type = null;
      if (!flat || r < 0.07) { if (rand() < 0.5) type = 'rock'; }
      else if (h > treeLine) { if (rand() < 0.12) type = 'rock'; }
      else if (clump < 0.42 && I.trees !== 'palm') { if (rand() < 0.14) type = 'bush'; }
      else if (I.trees === 'palm') type = h < 7 || rand() < 0.75 ? 'palm' : 'bush';
      else if (I.trees === 'pine') type = h < 2.2 ? 'bush' : 'pine';
      else if (I.trees === 'mixed') type = h < 4 && rand() < 0.5 ? 'palm' : rand() < 0.62 ? 'leaf' : rand() < 0.7 ? 'pine' : 'bush';
      else type = rand() < 0.45 ? 'bush' : rand() < 0.5 ? 'rock' : I.sandy ? 'palm' : 'pine';
      if (!type) continue;
      lists[type].push({ x, y: h - 0.15, z, s: 0.75 + rand() * 0.7, r: rand() * TAU });
    }
    // sea rocks near shore
    for (let t = 0; t < 14; t++) {
      const a = rand() * TAU, d = I.r * (0.75 + rand() * 0.5), x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d;
      const h = islandHeight(I, x, z);
      if (h < -0.2 && h > -2.2) lists.rock.push({ x, y: h + 0.3, z, s: 1.4 + rand() * 2.2, r: rand() * TAU });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    for (const type in lists) {
      const L = lists[type]; if (!L.length) continue;
      const im = new THREE.InstancedMesh(G[type], this.decorMat, L.length);
      L.forEach((o, i) => {
        const tilt = type === 'palm' ? 0.12 : type === 'rock' ? 0.5 : 0.04;
        e.set((Math.sin(o.r * 7) * tilt), o.r, Math.cos(o.r * 5) * tilt);
        q.setFromEuler(e);
        const s = type === 'rock' ? o.s * 1.3 : type === 'bush' ? o.s * 1.2 : o.s;
        sc.set(s, s * (type === 'pine' ? 0.9 + (o.r % 0.5) : 1), s); p.set(o.x, o.y, o.z);
        m.compose(p, q, sc); im.setMatrixAt(i, m);
        const v = 0.8 + ((o.r * 13.7) % 0.4);
        im.setColorAt(i, c.setRGB(v, v * (0.95 + ((o.r * 3.1) % 0.1)), v * 0.95));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      isl.decor.add(im);
    }
  }

  _addGlow(x, y, z, color, size, mode = 'night') {
    const mat = new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0 });
    const s = new THREE.Sprite(mat); s.position.set(x, y, z); s.scale.setScalar(size);
    this.group.add(s);
    const g = { sprite: s, mode, base: 1, size };
    this.nightGlows.push(g);
    return g;
  }

  _house(parts, windows, x, y, z, rot, w, d, wallH, wallCol, roofCol, tower = 0) {
    const add = (g, lx, ly, lz, list = parts) => { g.translate(lx, ly, lz); g.rotateY(rot); g.translate(x, y, z); list.push(g); };
    add(box(w, wallH + 2.5, d, wallCol), 0, wallH / 2 - 1.25, 0);
    const roof = paint(new THREE.CylinderGeometry(0, 1, 1, 4, 1), roofCol);
    roof.rotateY(Math.PI / 4); roof.scale(w * 0.8, tower ? 5 : 1.9, d * 0.8);
    add(roof, 0, wallH + (tower ? 2.5 : 0.95), 0);
    add(box(1.0, 1.9, 0.12, 0x4a3524), 0, 0.95, d / 2 + 0.02);
    const nw = Math.max(1, Math.floor(w / 2.6));
    for (let f = -1; f <= 1; f += 2) for (let i = 0; i < nw; i++) {
      const wx = ((i + 0.5) / nw - 0.5) * w * 0.8;
      if (f === 1 && Math.abs(wx) < 0.9) continue;
      for (let lv = 0; lv < (wallH > 4.5 ? 2 : 1); lv++) add(box(0.8, 0.95, 0.1, 0xffffff), wx, 1.9 + lv * 2.6, f * (d / 2 + 0.03), windows);
    }
    for (let f = -1; f <= 1; f += 2) add(box(0.1, 0.95, 0.8, 0xffffff), f * (w / 2 + 0.03), 1.9, 0, windows);
  }

  _buildHarbour(isl, rand, parts, windows, lamps) {
    const I = isl.def;
    const end = this._findShore(I, I.harbour, -3.4), land = this._findShore(I, I.harbour, 0.9);
    const dx = end.dx, dz = end.dz, px = -dz, pz = dx; // outward dir, perpendicular
    const len = Math.max(26, end.d - land.d + 8);
    const ex = land.x + dx * (len - 4), ez = land.z + dz * (len - 4);
    const rot = Math.atan2(dx, dz); // align local +Z with outward
    const deckY = 1.55;
    const add = (g, along, y, across) => { g.rotateY(rot); g.translate(land.x + dx * along + px * across, y, land.z + dz * along + pz * across); parts.push(g); };
    add(box(3.6, 0.22, len, 0x8b6f4c), len / 2 - 4, deckY, 0);
    for (let a = -3; a < len - 4; a += 5.5) for (const s of [-1.7, 1.7]) add(cyl(0.2, 0.2, 7, 6, 0x5a4632), a, deckY - 2.6, s);
    for (let a = 0; a < len - 5; a += 1.1) add(box(3.7, 0.06, 0.08, 0x6d573b), a, deckY + 0.12, 0);
    // T-head
    add(box(13, 0.22, 3.6, 0x8b6f4c), len - 5.8, deckY, 0);
    for (const s of [-6, -2, 2, 6]) add(cyl(0.22, 0.22, 8, 6, 0x5a4632), len - 4.4, deckY - 2.4, s);
    // cargo on the quay
    for (let i = 0; i < 5; i++) add(box(1, 1, 1, i % 2 ? 0x9c7a4d : 0x7d5f3a), len - 7 - rand() * 2, deckY + 0.6, -5 + i * 2.3 + rand());
    add(cyl(0.55, 0.55, 1.2, 8, 0x6e4a2c), len - 10, deckY + 0.7, 1.1);
    // lamp posts
    for (const [a, s] of [[2, 1.6], [len * 0.5, -1.6], [len - 5, 5.5], [len - 5, -5.5]]) {
      add(cyl(0.07, 0.09, 3.4, 5, 0x2b2b30), a, deckY + 1.7, s);
      const lg = new THREE.SphereGeometry(0.24, 8, 6); lg.rotateY(rot); lg.translate(land.x + dx * a + px * s, deckY + 3.5, land.z + dz * a + pz * s); lamps.push(lg);
      this._addGlow(land.x + dx * a + px * s, deckY + 3.5, land.z + dz * a + pz * s, 0xffc070, 5.5);
    }
    this.colliders.push({ x1: land.x - dx * 4, z1: land.z - dz * 4, x2: ex - dx * 1, z2: ez - dz * 1, r: 2.6 });
    this.colliders.push({ x1: ex - dx * 1.8 - px * 6.5, z1: ez - dz * 1.8 - pz * 6.5, x2: ex - dx * 1.8 + px * 6.5, z2: ez - dz * 1.8 + pz * 6.5, r: 2.4 });
    isl.dock = { x: ex + dx * 16, z: ez + dz * 16, berthX: ex + dx * 10, berthZ: ez + dz * 10, heading: Math.atan2(dx, -dz), outX: dx, outZ: dz };

    // village
    const palette = [0xf1e9d8, 0xe8c9a0, 0xd9a58a, 0xc9d6de, 0xf3e3b5, 0xe2b7a2];
    const roofs = [0xa5482f, 0x8f3a2a, 0x6c4a3a, 0x4a5a6a];
    const cx = land.x - dx * 34, cz = land.z - dz * 34;
    let placed = 0;
    for (let t = 0; t < 400 && placed < 11; t++) {
      const a = rand() * TAU, d = 8 + rand() * 95, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const h = islandHeight(I, x, z);
      if (h < 1.8 || h > 30 || !this._slopeOK(I, x, z, 0.3)) continue;
      if (isl.houses.some((o) => (o.x - x) ** 2 + (o.z - z) ** 2 < 120)) continue;
      const big = placed === 0;
      const w = big ? 8 : 5 + rand() * 2.5, d2 = big ? 7 : 4.5 + rand() * 1.5, wh = big ? 6.2 : 3 + rand() * 1.6;
      const r = Math.atan2(land.x - x, land.z - z) + (rand() - 0.5) * 0.9;
      this._house(parts, windows, x, h, z, r, w, d2, wh, palette[Math.floor(rand() * palette.length)], roofs[Math.floor(rand() * roofs.length)]);
      if (big) this._house(parts, windows, x + Math.cos(r) * 5.2, h, z - Math.sin(r) * 5.2, r, 3.2, 3.2, 10, 0xefe6d2, 0x4a5a6a, 1);
      isl.houses.push({ x, z }); placed++;
    }
    // channel buoys
    const bx = isl.dock.x + dx * 46, bz = isl.dock.z + dz * 46;
    this._buoy(bx + px * 17, bz + pz * 17, 0xc8372d, 0xff4030);
    this._buoy(bx - px * 17, bz - pz * 17, 0x2f8f4e, 0x40ff80);
  }

  _buoy(x, z, color, light, big = false) {
    const g = mergeGeos([
      cyl(0.75, 0.55, 0.9, 10, color), place(cyl(0.1, 0.45, 1.7, 8, color), 0, 1.25, 0),
      place(cyl(0.18, 0.18, 0.3, 8, 0xf5f0e0), 0, 2.2, 0),
    ]);
    const m = new THREE.Mesh(g, this.buildMat);
    if (big) m.scale.setScalar(1.5);
    m.position.set(x, 0, z); this.group.add(m);
    const glow = this._addGlow(x, 2.4, z, light, big ? 7 : 4.5, 'blink');
    glow.phase = (x * 0.37) % 3;
    const b = { mesh: m, x, z, glow, n: new THREE.Vector3() };
    this.buoys.push(b); return b;
  }

  _extraBuoy() {
    const d = this.byId.haven.dock;
    this.tutorialBuoy = this._buoy(d.x + d.outX * 330 + d.outZ * 60, d.z + d.outZ * 330 - d.outX * 60, 0xe2a52b, 0xffd24a, true);
  }

  _buildLighthouse(isl, parts, lamps) {
    const I = isl.def;
    let p = this._findShore(I, I.lighthouse, 7);
    const x = p.x - p.dx * 6, z = p.z - p.dz * 6, y = islandHeight(I, x, z) - 0.5;
    const H = 20;
    for (let i = 0; i < 5; i++) {
      const r0 = lerp(3.3, 2.1, i / 5), r1 = lerp(3.3, 2.1, (i + 1) / 5);
      parts.push(place(cyl(r1, r0, H / 5, 14, i % 2 ? 0xb5362c : 0xf4efe6), x, y + (i + 0.5) * H / 5, z));
    }
    parts.push(place(cyl(3.4, 3.8, 1.2, 14, 0x8a8580), x, y + 0.3, z));
    parts.push(place(cyl(3.0, 2.6, 0.35, 14, 0x2e3138), x, y + H + 0.15, z));
    parts.push(place(paint(new THREE.ConeGeometry(2.1, 1.8, 12), 0xb5362c), x, y + H + 3.6, z));
    for (let k = 0; k < 6; k++) parts.push(place(box(0.12, 2.4, 0.12, 0x2e3138), x + Math.cos(k * TAU / 6) * 1.55, y + H + 1.5, z + Math.sin(k * TAU / 6) * 1.55));
    lamps.push(place(new THREE.CylinderGeometry(1.2, 1.2, 2.1, 10), x, y + H + 1.5, z));
    // keeper's cottage
    this._house(parts, [], x - p.dx * 9 + p.dz * 4, islandHeight(I, x - p.dx * 9 + p.dz * 4, z - p.dz * 9 - p.dx * 4), z - p.dz * 9 - p.dx * 4, I.lighthouse * DEG, 5.5, 4.5, 3, 0xf1e9d8, 0x8f3a2a);
    const beam = new THREE.Group(); beam.position.set(x, y + H + 1.5, z);
    for (const s of [1, -1]) {
      const cg = new THREE.ConeGeometry(20, 420, 20, 6, true); cg.translate(0, -210, 0); cg.rotateZ(s * Math.PI / 2);
      const cm = new THREE.Mesh(cg, this.beamMat); cm.renderOrder = 5; beam.add(cm);
    }
    beam.rotation.z = 0.035;
    this.group.add(beam); this.beams.push(beam);
    isl.light = { x, y: y + H + 1.5, z };
    isl.lightGlow = this._addGlow(x, y + H + 1.5, z, 0xffe6a0, 34);
  }

  _buildBeacon(isl, parts) {
    const I = isl.def;
    const p = this._findShore(I, I.beacon, 5);
    const x = p.x - p.dx * 8, z = p.z - p.dz * 8, y = Math.max(islandHeight(I, x, z) - 1.0, 1);
    const stone = 0x6a6878, dark = 0x4d4b5c, gold = 0xc9a24a;
    parts.push(place(cyl(5.5, 6.5, 2.2, 10, dark), x, y + 0.6, z));
    parts.push(place(cyl(2.3, 3.6, 17, 8, stone), x, y + 9.5, z));
    parts.push(place(cyl(2.6, 2.6, 0.5, 8, gold), x, y + 13, z));
    parts.push(place(cyl(3.6, 2.3, 1.6, 8, dark), x, y + 18.6, z));
    parts.push(place(cyl(3.2, 3.2, 0.3, 8, gold), x, y + 19.5, z));
    for (let k = 0; k < 5; k++) {
      const a = k * TAU / 5 + 0.3;
      parts.push(place(box(1.3, 5.5 + (k % 2), 0.9, stone), x + Math.cos(a) * 9.5, y + 2, z + Math.sin(a) * 9.5, -a, 0, 0.08));
    }
    const top = y + 20.2;
    const g = new THREE.Group(); g.position.set(x, top, z);
    const mk = (r0, r1) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
        vertexShader: 'varying float vY; varying vec3 vN; varying vec3 vV; void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying float vY; varying vec3 vN; varying vec3 vV; uniform float opacity; void main(){ float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.5); float a = opacity * edge * exp(-vY / 520.0) * smoothstep(0.0, 6.0, vY + 1.0); gl_FragColor = vec4(vec3(1.0, 0.82, 0.5) * a, a); }',
      });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1500, 16, 8, true).translate(0, 750, 0), m); mesh.renderOrder = 5; mesh.frustumCulled = false; g.add(mesh); return mesh;
    };
    const beam = mk(1.3, 2.6), halo = mk(5, 16);
    this.group.add(g);
    const glow = this._addGlow(x, top + 1, z, 0xffc866, 30, 'beacon');
    glow.sprite.material.opacity = 0;
    const flame = this._addGlow(x, top + 1.2, z, 0xfff2c8, 13, 'beacon');
    let reach = 0;
    for (let d = 0; d < 600; d += 4) { if (islandHeight(I, x + p.dx * d, z + p.dz * d) < -2.5) { reach = d; break; } }
    isl.beacon = { x, y: top, z, beam, halo, glow, flame, level: 0, g, reach: reach + 130 };
    g.visible = false;
  }

  setBeaconLit(id, lit, instant) {
    const isl = this.byId[id]; if (!isl || !isl.beacon) return;
    isl.lit = lit;
    if (instant) isl.beacon.level = lit ? 1 : 0;
  }

  _buildWreck(isl, parts) {
    const I = isl.def;
    const p = this._findShore(I, I.wreck, -3.0);
    const x = p.x + p.dx * 8, z = p.z + p.dz * 8;
    const wood = 0x4d3b2a, wood2 = 0x3a2c20;
    const rot = I.seed, tilt = 0.42;
    const hull = new THREE.SphereGeometry(1, 14, 8, 0, TAU, Math.PI * 0.42, Math.PI * 0.58);
    hull.scale(3.2, 3.4, 10.5);
    const T = (g) => { g.rotateZ(tilt); g.rotateX(-0.12); g.rotateY(rot); g.translate(x, -0.3, z); parts.push(g); };
    T(paint(hull, wood));
    for (let k = -3; k <= 3; k++) T(place(box(6.2 * Math.sqrt(1 - (k / 4.2) ** 2), 0.25, 0.3, wood2), 0, 0.5, k * 2.4));
    T(place(cyl(0.22, 0.32, 13, 6, wood2), 0, 6, -1.5, 0, 0.1, 0.12));
    T(place(box(5.5, 0.2, 0.2, wood2), 0.9, 9.5, -2.2));
    T(place(cyl(0.16, 0.24, 6, 6, wood2), 0, 3, 5.5, 0, -0.5, 0));
    isl.wreck = { x, z, glint: this._addGlow(x, 4.5, z, 0xffe9a8, 9, 'glint') };
  }

  _buildGate(isl, parts) {
    const I = isl.def;
    let best = { h: -1e9 };
    for (let a = 0; a < TAU; a += 0.2) for (let d = 0; d < I.r * 0.5; d += 12) {
      const x = I.x + Math.cos(a) * d, z = I.z + Math.sin(a) * d, h = islandHeight(I, x, z);
      if (h > best.h) best = { x, z, h };
    }
    const { x, z } = best, y = best.h - 2, stone = 0xd8d2c4, gold = 0xd6b25a;
    for (const s of [-1, 1]) {
      parts.push(place(box(7, 64, 7, stone), x + s * 22, y + 30, z));
      parts.push(place(box(9, 3, 9, gold), x + s * 22, y + 62, z));
      parts.push(place(box(10, 4, 10, stone), x + s * 22, y + 1, z));
    }
    const arch = paint(new THREE.TorusGeometry(22, 3.2, 8, 24, Math.PI), stone); parts.push(place(arch, x, y + 62, z));
    for (let k = 0; k < 9; k++) {
      const a = k * TAU / 9;
      parts.push(place(box(2.4, 9 + (k % 3) * 2, 1.6, stone), x + Math.cos(a) * 46, islandHeight(I, x + Math.cos(a) * 46, z + Math.sin(a) * 46) + 3, z + Math.sin(a) * 46, -a));
    }
    const portalMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uOn: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform float uTime; uniform float uOn; varying vec2 vUv;
        void main(){ vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = atan(p.y, p.x);
          float sw = sin(a * 5.0 + r * 9.0 - uTime * 1.4) * 0.5 + 0.5;
          float m = smoothstep(1.0, 0.2, r) * (0.55 + 0.45 * sw);
          gl_FragColor = vec4(mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.97, 0.85), 1.0 - r) * 2.2, m * uOn); }`,
    });
    const portal = new THREE.Mesh(new THREE.CircleGeometry(21, 40), portalMat);
    portal.position.set(x, y + 52, z); portal.scale.set(1, 1.5, 1); portal.renderOrder = 5;
    this.group.add(portal);
    isl.gate = { x, y: y + 50, z, portal, glow: this._addGlow(x, y + 50, z, 0xffdf9a, 150, 'gate') };
  }

  // segment colliders (piers): pushes point out, returns true if hit
  collide(pos, radius, out) {
    let hit = false;
    for (const c of this.colliders) {
      const vx = c.x2 - c.x1, vz = c.z2 - c.z1, wx = pos.x - c.x1, wz = pos.z - c.z1;
      const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
      const qx = c.x1 + vx * t, qz = c.z1 + vz * t, dx = pos.x - qx, dz = pos.z - qz, d = Math.hypot(dx, dz), R = c.r + radius;
      if (d < R && d > 1e-4) { out.x = dx / d; out.z = dz / d; pos.x = qx + out.x * R; pos.z = qz + out.z * R; hit = true; }
    }
    return hit;
  }

  update(dt, time, night, camPos, ocean, gateOn) {
    this.night = night;
    this.windowMat.emissiveIntensity = night * 2.6;
    this.lampMat.emissiveIntensity = 0.3 + night * 5;
    this.beamMat.uniforms.opacity.value = night * 0.55;
    for (const b of this.beams) b.rotation.y = time * 0.5;
    for (const isl of this.islands) {
      const I = isl.def, d = Math.hypot(camPos.x - I.x, camPos.z - I.z);
      isl.group.visible = d < 7800;
      isl.decor.visible = d < 3200 + I.r;
      const bc = isl.beacon;
      if (bc) {
        bc.level = clamp(bc.level + (isl.lit ? dt * 0.35 : -dt), 0, 1);
        bc.g.visible = bc.level > 0.001;
        const fl = 0.85 + 0.15 * Math.sin(time * 7 + I.seed) * Math.sin(time * 11.3);
        bc.beam.material.uniforms.opacity.value = bc.level * (0.55 + 0.5 * night) * fl;
        bc.halo.material.uniforms.opacity.value = bc.level * (0.10 + 0.14 * night);
        bc.glow.base = bc.level * (0.3 + 0.5 * night) * fl; bc.flame.base = bc.level * fl;
      }
      if (isl.gate) {
        const u = isl.gate.portal.material.uniforms;
        u.uTime.value = time; u.uOn.value = lerp(u.uOn.value, gateOn ? 1 : 0, dt * 0.5);
        isl.gate.portal.lookAt(camPos.x, isl.gate.portal.position.y, camPos.z);
        isl.gate.glow.base = u.uOn.value * 0.6;
      }
      if (isl.wreck) isl.wreck.glint.base = isl.wreck.looted ? 0 : 0.35 + 0.35 * Math.sin(time * 2.2);
    }
    for (const g of this.nightGlows) {
      let o;
      if (g.mode === 'night') o = night;
      else if (g.mode === 'blink') o = (0.25 + night * 0.75) * (((time + g.phase) % 3) < 0.5 ? 1 : 0.05);
      else o = g.base;
      g.sprite.material.opacity = o; g.sprite.visible = o > 0.01;
    }
    for (const b of this.buoys) {
      if (Math.abs(b.x - camPos.x) > 900 || Math.abs(b.z - camPos.z) > 900) continue;
      const y = ocean.height(b.x, b.z, b.n);
      b.mesh.position.y = y - 0.15;
      b.mesh.rotation.set(b.n.z * 0.9, 0, -b.n.x * 0.9);
      b.glow.sprite.position.y = y + (b.mesh.scale.x > 1 ? 3.4 : 2.3);
    }
  }
}

// The player's sloop: procedural model, sail aerodynamics, hull hydrodynamics, buoyancy
import * as THREE from 'three';
import { TAU, DEG, clamp, lerp, damp, smoothstep, wrapAngle, mergeGeos, paint, box, cyl, place } from './util.js';

const L = 9.2, B = 1.5;
const D_MIN = 7 * DEG, D_MAX = 86 * DEG;
const SAIL_AREA = [0, 0.4, 0.72, 1.0];
export const SAIL_NAMES = ['Furled', 'Storm reef', 'Reefed', 'Full sail'];
const SAILK = 0.0078, DRAG_L = 0.03, DRAG_Q = 0.017, LAT_L = 0.9, LAT_Q = 0.65, HEELK = 0.43, TURN = 0.62;
const SAIL_COLORS = [0xe9e2d0, 0xf4efe2, 0xb5533c, 0xf7f3ea, 0xf2cf73];

// normalised sail force for apparent wind angle A (0..PI) and boom angle d
function sailCoef(A, d) {
  const al = A - d;
  if (al <= 0) return [0, 0, 0];
  const luff = smoothstep(0.02, 0.12, al);
  const CL = (Math.sin(2 * al) + 0.75 * Math.exp(-Math.pow((al - 0.37) / 0.19, 2))) * luff;
  const CD = 0.06 + 1.25 * Math.sin(al) * Math.sin(al) * luff;
  return [CL * Math.sin(A) - CD * Math.cos(A), CL * Math.cos(A) + CD * Math.sin(A), luff];
}

function hullGeometry() {
  const NS = 20, M = 7, W = 2 * M + 1;
  const pos = [], col = [], idx = [];
  const cW = new THREE.Color(0xf3efe6), cR = new THREE.Color(0x7c2f2a), cN = new THREE.Color(0x1d3a5c), cG = new THREE.Color(0xc9a24a);
  const prof = (t) => {
    const b = t < 0.42 ? B * (0.66 + 0.34 * smoothstep(0, 0.42, t)) : B * Math.pow(Math.max(0, 1 - Math.pow((t - 0.42) / 0.58, 2.1)), 0.8);
    return { b: Math.max(b, 0.035), yd: 0.92 + 0.5 * Math.pow(t, 2.4) + 0.07 * (1 - t) * (1 - t), yk: -0.52 + 1.25 * Math.pow(t, 5) + 0.34 * Math.pow(1 - t, 3) };
  };
  const gunwale = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, z = L / 2 - t * L - Math.pow(t, 3) * 0.5, { b, yd, yk } = prof(t);
    for (let j = -M; j <= M; j++) {
      const s = Math.abs(j) / M, sg = Math.sign(j);
      const x = sg * b * Math.pow(Math.sin(s * Math.PI / 2), 0.72);
      const y = yk + (yd - yk) * Math.pow(1 - Math.cos(s * Math.PI / 2), 0.85);
      pos.push(x, y, z);
      const c = y < 0.1 ? cR : y < 0.16 ? cG : s > 0.93 ? cN : cW;
      col.push(c.r, c.g, c.b);
    }
    gunwale.push([b, yd, z]);
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < W - 1; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  // transom + deck (flat shaded)
  const dp = [], teak = 0xb48a58;
  const p0 = prof(0);
  for (let j = 0; j < W - 1; j++) dp.push(0, p0.yd * 0.6, L / 2, pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2], pos[(j + 1) * 3], pos[(j + 1) * 3 + 1], pos[(j + 1) * 3 + 2]);
  const transom = new THREE.BufferGeometry(); transom.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); transom.computeVertexNormals(); paint(transom, 0xf3efe6);
  const dk = [];
  for (let i = 0; i < NS; i++) {
    const [b0, y0, z0] = gunwale[i], [b1, y1, z1] = gunwale[i + 1], c0 = y0 + 0.05, c1 = y1 + 0.05;
    const y0d = y0 - 0.04, y1d = y1 - 0.04;
    dk.push(-b0, y0d, z0, 0, c0, z0, -b1, y1d, z1, 0, c0, z0, 0, c1, z1, -b1, y1d, z1,
            0, c0, z0, b0, y0d, z0, 0, c1, z1, b0, y0d, z0, b1, y1d, z1, 0, c1, z1);
  }
  const deck = new THREE.BufferGeometry(); deck.setAttribute('position', new THREE.Float32BufferAttribute(dk, 3)); deck.computeVertexNormals(); paint(deck, teak);
  return mergeGeos([g, transom, deck]);
}

function sailTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 512);
  for (let y = 0; y < 512; y += 46) { g.fillStyle = 'rgba(60,50,30,0.16)'; g.fillRect(0, y, 256, 2); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, y + 2, 256, 2); }
  const gr = g.createLinearGradient(0, 0, 256, 0); gr.addColorStop(0, 'rgba(90,70,40,0.14)'); gr.addColorStop(0.2, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(60,50,30,0.1)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 512);
  // emblem: a sun on the horizon
  g.save(); g.translate(86, 300); g.strokeStyle = 'rgba(196,140,50,0.9)'; g.fillStyle = 'rgba(196,140,50,0.9)'; g.lineWidth = 5;
  g.beginPath(); g.arc(0, 0, 26, Math.PI, 0); g.fill();
  for (let i = 0; i < 7; i++) { const a = Math.PI + (i / 6) * Math.PI; g.beginPath(); g.moveTo(Math.cos(a) * 34, Math.sin(a) * 34); g.lineTo(Math.cos(a) * 48, Math.sin(a) * 48); g.stroke(); }
  g.fillRect(-56, 6, 112, 5); g.fillRect(-40, 18, 80, 4); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function gridGeo(nu, nv) {
  const g = new THREE.BufferGeometry(), V = (nu + 1) * (nv + 1);
  const uv = new Float32Array(V * 2), idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) { uv[(j * (nu + 1) + i) * 2] = i / nu; uv[(j * (nu + 1) + i) * 2 + 1] = j / nv; }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

export class Boat {
  constructor(scene) {
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.heading = 0; this.yawRate = 0; this.rudder = 0;
    this.heel = 0; this.pitch = 0; this.roll = 0; this.y = 0;
    this.sheet = 0.5; this.sailLevel = 0; this.hoist = 0; this.jibHoist = 0; this.boom = 0;
    this.autoTrim = false; this.anchored = true;
    this.upg = { sails: 0, keel: 0, hull: 0 };
    this.speed = 0; this.awa = 0; this.aws = 0; this.twa = 0; this.eff = 0; this.luff = 0; this.drive = 0;
    this.aground = false; this.inIrons = false; this.overpowered = 0;
    this.ext = new THREE.Vector3(); // external acceleration (currents)
    this.onDamage = null; this.onSlam = null;
    this._hitCd = 0; this._effT = 0; this._prevPitch = 0; this._kd = 0;
    this.t = 0; this.fill = 0;
    this.fwd = new THREE.Vector3(0, 0, -1); this.right = new THREE.Vector3(1, 0, 0);
    this._n = new THREE.Vector3();
    this._build(scene);
  }

  _build(scene) {
    const g = this.mesh = new THREE.Group(); g.rotation.order = 'YXZ';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(hullGeometry(), mat); hull.castShadow = hull.receiveShadow = true; g.add(hull);
    const white = 0xf3efe6, teak = 0xa67c4c, dark = 0x2a2d33, brass = 0xc9a24a, wood = 0x7b5a3a;
    const parts = [
      place(box(1.7, 0.62, 2.7, white), 0, 1.28, -0.9), place(box(1.84, 0.07, 2.84, teak), 0, 1.62, -0.9),
      place(box(0.07, 0.24, 2.5, teak), -1.0, 1.1, 2.4), place(box(0.07, 0.24, 2.5, teak), 1.0, 1.1, 2.4),
      place(box(2.0, 0.24, 0.07, teak), 0, 1.1, 1.15),
      place(box(0.8, 0.07, 0.5, teak), 0, 1.2, 3.35), // helm seat
      place(box(0.13, 1.25, 2.3, 0x5d2522), 0, -0.9, 0.2), // keel fin
      place(cyl(0.05, 0.07, 1.9, 6, wood), 0, 1.5, -5.25, 0, Math.PI / 2 - 0.08), // bowsprit
      place(cyl(0.075, 0.11, 12.4, 8, wood), 0, 7.6, -1.1), // mast
      place(box(2.3, 0.05, 0.08, wood), 0, 8.2, -1.1), // spreaders
      place(box(0.5, 0.5, 0.04, dark), -0.86, 1.32, -1.5, Math.PI / 2), place(box(0.5, 0.5, 0.04, dark), -0.86, 1.32, -0.4, Math.PI / 2),
      place(box(0.5, 0.5, 0.04, dark), 0.86, 1.32, -1.5, Math.PI / 2), place(box(0.5, 0.5, 0.04, dark), 0.86, 1.32, -0.4, Math.PI / 2),
      place(box(0.6, 0.5, 0.05, wood), 0, 1.25, 0.47), // companionway
      place(cyl(0.035, 0.035, 0.5, 6, brass), -1.15, 1.25, 3.7), place(cyl(0.035, 0.035, 0.5, 6, brass), 1.15, 1.25, 3.7),
      place(cyl(0.03, 0.03, 1.1, 6, brass), 0, 1.6, 4.35), // lantern post
      // sailor
      place(cyl(0.2, 0.24, 0.62, 8, 0x26476b), 0.34, 1.68, 3.3), place(paint(new THREE.SphereGeometry(0.17, 10, 8), 0xe2b48c), 0.34, 2.14, 3.3),
      place(cyl(0.19, 0.2, 0.1, 8, 0xc23b2e), 0.34, 2.28, 3.3), place(box(0.5, 0.16, 0.2, 0x26476b), 0.2, 1.75, 3.05, 0.5),
      place(box(0.36, 0.2, 0.5, 0x3a3f4a), 0.34, 1.3, 3.05),
    ];
    const detail = new THREE.Mesh(mergeGeos(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true }));
    detail.castShadow = detail.receiveShadow = true; g.add(detail);

    this.rudderMesh = new THREE.Mesh(mergeGeos([place(box(0.07, 1.5, 0.55, wood), 0, -0.25, 0.3), place(box(0.05, 0.06, 1.3, wood), 0, 0.72, -0.6)]), detail.material);
    this.rudderMesh.position.set(0, 0.75, 4.55); g.add(this.rudderMesh);

    this.boomPivot = new THREE.Group(); this.boomPivot.position.set(0, 2.5, -1.1);
    const boom = new THREE.Mesh(place(cyl(0.06, 0.06, 4.4, 6, wood), 0, 0, 2.2, 0, Math.PI / 2), detail.material); boom.castShadow = true;
    this.boomPivot.add(boom); g.add(this.boomPivot);

    // rigging
    const rig = [0, 13.7, -1.1, 0, 1.55, -6.2, 0, 13.7, -1.1, 0, 1.0, 4.6, 0, 8.2, -1.1, -1.15, 8.2, -1.1, 0, 8.2, -1.1, 1.15, 8.2, -1.1,
      -1.15, 8.2, -1.1, -1.4, 0.95, -0.9, 1.15, 8.2, -1.1, 1.4, 0.95, -0.9, -1.15, 8.2, -1.1, 0, 13.5, -1.1, 1.15, 8.2, -1.1, 0, 13.5, -1.1];
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rig, 3));
    g.add(new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x1c1c20, transparent: true, opacity: 0.75 })));

    // sails
    this.sailMat = new THREE.MeshStandardMaterial({ color: SAIL_COLORS[0], map: sailTexture(), side: THREE.DoubleSide, roughness: 0.92, emissive: 0x332b1c, emissiveIntensity: 0.25 });
    this.main = new THREE.Mesh(gridGeo(8, 12), this.sailMat); this.main.castShadow = true; this.main.frustumCulled = false; g.add(this.main);
    const jibMat = this.sailMat.clone(); jibMat.map = null; this.jibMat = jibMat;
    this.jib = new THREE.Mesh(gridGeo(6, 10), jibMat); this.jib.castShadow = true; this.jib.frustumCulled = false; g.add(this.jib);

    // pennant
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(15), 3)); pg.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    this.pennant = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xc23b2e, side: THREE.DoubleSide })); this.pennant.frustumCulled = false; g.add(this.pennant);

    // lights
    this.lanternMat = new THREE.MeshStandardMaterial({ color: 0xffe2a0, emissive: 0xffb658, emissiveIntensity: 0 });
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), this.lanternMat); lantern.position.set(0, 2.2, 4.35); g.add(lantern);
    this.lanternLight = new THREE.PointLight(0xffb060, 0, 16, 1.6); this.lanternLight.position.set(0, 2.4, 4.0); g.add(this.lanternLight);
    this.navMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
    const nav = new THREE.Mesh(mergeGeos([place(paint(new THREE.SphereGeometry(0.07, 8, 6), 0xff2a1a), -0.75, 1.5, -3.4), place(paint(new THREE.SphereGeometry(0.07, 8, 6), 0x1aff5a), 0.75, 1.5, -3.4),
      place(paint(new THREE.SphereGeometry(0.07, 8, 6), 0xffffff), 0, 13.85, -1.1)]), this.navMat);
    this.navMat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= vColor.rgb;'); };
    g.add(nav);
    scene.add(g);
  }

  setUpgrades(u, golden) {
    this.upg = u;
    const c = golden ? SAIL_COLORS[4] : SAIL_COLORS[u.sails] ?? SAIL_COLORS[0];
    this.sailMat.color.set(c); this.jibMat.color.set(c);
  }

  setSail(level) { this.sailLevel = clamp(level, 0, 3); if (this.sailLevel > 0) this.anchored = false; }

  teleport(x, z, heading) {
    this.pos.set(x, 0, z); this.vel.set(0, 0, 0); this.heading = heading; this.yawRate = 0; this.heel = 0; this.boom = 0;
  }

  update(dt, ctl, wind, ocean, world) {
    this.t += dt;
    const h = this.heading, fx = Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    let u = this.vel.x * fx + this.vel.z * fz, v = this.vel.x * rx + this.vel.z * rz;
    this.rudder = damp(this.rudder, ctl.steer, 6, dt);

    // --- wind ---
    const ax = wind.vx - this.vel.x, az = wind.vz - this.vel.z;
    const aws = Math.hypot(ax, az) + 1e-5, af = ax * fx + az * fz, as = ax * rx + az * rz;
    const awa = Math.atan2(-as, -af), A = Math.abs(awa), side = awa >= 0 ? 1 : -1;
    this.awa = awa; this.aws = aws;
    this.twa = wrapAngle(wind.dir - h);
    const hx = Math.cos(this.heel);

    // --- sails ---
    this.hoist = damp(this.hoist, SAIL_AREA[this.sailLevel], 2.2, dt);
    this.jibHoist = damp(this.jibHoist, this.sailLevel >= 2 ? 1 : 0, 2.0, dt);
    if (this.autoTrim) {
      const dT = clamp(A - 0.4, D_MIN, D_MAX);
      this.sheet = damp(this.sheet, (dT - D_MIN) / (D_MAX - D_MIN), 2.5, dt);
    } else this.sheet = clamp(this.sheet + ctl.sheet * dt * 0.42, 0, 1);
    const dLim = lerp(D_MIN, D_MAX, this.sheet), d = Math.min(A, dLim);
    const [cx, cy, luff] = sailCoef(A, d);
    this.luff = this.hoist > 0.05 ? 1 - luff : 0;
    this.boom = damp(this.boom, -side * d, this.hoist > 0.05 ? 5 : 2, dt);
    const area = this.hoist * (1 + 0.1 * this.upg.sails);
    const q = SAILK * area * aws * aws;
    let Fx = q * cx * Math.pow(hx, 1.5), Fy = -side * q * cy;
    this.drive = Fx;
    this.fill = damp(this.fill, -side * clamp(q * (Math.abs(cx) + cy) * 1.2, 0, 1) * luff, 5, dt);
    // windage of bare hull and rig
    Fx += 0.0006 * aws * af; Fy += 0.0009 * aws * as;

    // trim efficiency readout
    this._effT -= dt;
    if (this._effT <= 0) {
      this._effT = 0.12;
      let best = 0;
      for (let i = 0; i <= 14; i++) { const dd = lerp(D_MIN, Math.min(A, D_MAX), i / 14); best = Math.max(best, sailCoef(A, dd)[0]); }
      this.eff = best > 0.02 ? clamp(cx / best, 0, 1) : 0;
      this.bestDrive = best;
      this.inIrons = best <= 0.02 && this.hoist > 0.2;
    }

    // --- hull forces (boat frame accelerations) ---
    const keel = 1 + 0.14 * this.upg.keel;
    let au = Fx - (DRAG_L * u + DRAG_Q * u * Math.abs(u)) - 0.05 * Math.pow(Math.max(0, Math.abs(u) - 5.2), 2) * Math.sign(u);
    au -= Math.abs(this.yawRate) * u * 0.22;
    let av = Fy - (LAT_L * v + LAT_Q * v * Math.abs(v)) * keel;
    if (Math.abs(this.heel) > 0.6) au -= u * (Math.abs(this.heel) - 0.6) * 0.5;
    if (this.anchored) { au -= u * 1.6; av -= v * 2.5; }
    au += this.ext.x * fx + this.ext.z * fz; av += this.ext.x * rx + this.ext.z * rz;
    u += au * dt; v += av * dt;

    // --- steering ---
    const steerPow = (u / (Math.abs(u) + 2.0)) * (1 + 0.09 * this.upg.keel);
    let yawT = this.rudder * TURN * steerPow + this.rudder * 0.07;
    if (this.luff > 0.6 && Math.abs(u) < 1.2 && !this.anchored) yawT -= side * 0.11 * Math.min(aws / 8, 1.5); // falls off when in irons
    yawT += side * Math.abs(this.heel) * 0.05 * clamp(u / 5, 0, 1); // weather helm
    this.yawRate = damp(this.yawRate, yawT, 2.6, dt);
    this.heading = wrapAngle(this.heading + this.yawRate * dt);

    // --- heel ---
    const heelT = clamp(Fy * hx * hx * HEELK / (1 + 0.16 * this.upg.keel), -1.2, 1.2);
    this.heel = damp(this.heel, -heelT * -1, 1.8, dt); // +heel = leaning to starboard; Fy>0 pushes to starboard
    this.overpowered = smoothstep(0.55, 0.85, Math.abs(this.heel));
    this._kd -= dt;
    if (Math.abs(this.heel) > 0.92 && this._kd <= 0) { // knockdown
      this._kd = 6; this.sheet = 1; u *= 0.45; if (this.sailLevel > 1) this.sailLevel = 1;
      if (this.onDamage) this.onDamage(9, 'knockdown');
    } else if (Math.abs(this.heel) > 0.74 && this.onDamage) this.onDamage(dt * 0.9, 'strain');

    // back to world
    this.vel.x = fx * u + rx * v; this.vel.z = fz * u + rz * v;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.speed = u; this.leeway = v;

    // --- collisions ---
    this._hitCd -= dt;
    const th = world.heightAt(this.pos.x, this.pos.z), draft = -1.15;
    this.aground = false;
    if (th > draft) {
      const e = 5, gx = (world.heightAt(this.pos.x + e, this.pos.z) - world.heightAt(this.pos.x - e, this.pos.z)), gz = (world.heightAt(this.pos.x, this.pos.z + e) - world.heightAt(this.pos.x, this.pos.z - e));
      const gl = Math.hypot(gx, gz) + 1e-5, nx = -gx / gl, nz = -gz / gl; // points to deeper water
      const pen = th - draft;
      this.pos.x += nx * Math.min(pen * 2.5, 1.2); this.pos.z += nz * Math.min(pen * 2.5, 1.2);
      const vn = this.vel.x * nx + this.vel.z * nz, sp = Math.hypot(this.vel.x, this.vel.z);
      if (vn < 0) { this.vel.x -= nx * vn * 1.15; this.vel.z -= nz * vn * 1.15; }
      this.vel.multiplyScalar(Math.exp(-dt * 2.2));
      this.aground = true;
      if (sp > 1.6 && this._hitCd <= 0 && this.onDamage) { this._hitCd = 1.4; this.onDamage((sp - 1.2) * 4.2, 'aground'); }
    }
    if (world.collide(this.pos, 1.5, this._n)) {
      const vn = this.vel.x * this._n.x + this.vel.z * this._n.z, sp = Math.abs(vn);
      if (vn < 0) { this.vel.x -= this._n.x * vn * 1.2; this.vel.z -= this._n.z * vn * 1.2; }
      if (sp > 2.2 && this._hitCd <= 0 && this.onDamage) { this._hitCd = 1.4; this.onDamage((sp - 1.6) * 3.5, 'pier'); }
    }

    // --- buoyancy ---
    const px = this.pos.x, pz = this.pos.z;
    const hc = ocean.height(px, pz), hb = ocean.height(px + fx * 3.7, pz + fz * 3.7), hs = ocean.height(px - fx * 3.7, pz - fz * 3.7);
    const hp = ocean.height(px - rx * 1.3, pz - rz * 1.3), hsb = ocean.height(px + rx * 1.3, pz + rz * 1.3);
    this.y = damp(this.y, hc * 0.4 + (hb + hs + hp + hsb) * 0.15, 7, dt);
    const pitchT = Math.atan2(hb - hs, 7.4) * 0.9 + clamp(u * 0.004, 0, 0.05);
    this.pitch = damp(this.pitch, pitchT, 4.5, dt);
    this.roll = damp(this.roll, Math.atan2(hp - hsb, 2.6) * 0.7, 3.5, dt);
    const pr = (this.pitch - this._prevPitch) / Math.max(dt, 1e-3); this._prevPitch = this.pitch;
    if (pr < -0.22 && u > 3 && this.onSlam && this._slamCd <= 0) { this._slamCd = 0.8; this.onSlam(clamp(-pr * u * 0.25, 0.2, 1.5)); }
    this._slamCd = (this._slamCd || 0) - dt;

    this.fwd.set(fx, 0, fz); this.right.set(rx, 0, rz);
    this.pos.y = this.y;
    this._pose(dt, wind);
  }

  _pose(dt, wind) {
    const g = this.mesh;
    g.position.set(this.pos.x, this.y + 0.04, this.pos.z);
    g.rotation.set(this.pitch, -this.heading, -(this.heel + this.roll));
    this.rudderMesh.rotation.y = -this.rudder * 0.55;
    this.boomPivot.rotation.y = this.boom;

    // mainsail
    const t = this.t, fill = this.fill, lf = this.luff, hoist = this.hoist;
    const mp = this.main.geometry.attributes.position, NU = 8, NV = 12;
    const tackY = 2.62, mastZ = -1.05, headY = tackY + 10.6 * hoist;
    this.main.visible = hoist > 0.03;
    if (this.main.visible) {
      for (let j = 0; j <= NV; j++) {
        const vv = j / NV, ang = this.boom * (1 + 0.22 * vv), sx = Math.sin(ang), cz = Math.cos(ang);
        const chord = (4.15 + 0.5 * Math.sin(vv * Math.PI) * hoist) * (1 - vv * 0.985);
        for (let i = 0; i <= NU; i++) {
          const uu = i / NU, o = (j * (NU + 1) + i) * 3;
          const camber = Math.sin(Math.pow(uu, 0.8) * Math.PI) * chord * 0.13 * fill * (0.5 + 0.5 * hoist)
            + lf * Math.sin(t * 17 + vv * 9 + uu * 6) * 0.1 * uu * (1 - vv * 0.5);
          mp.array[o] = sx * chord * uu + cz * camber;
          mp.array[o + 1] = lerp(tackY, headY, vv) + 0.1 * uu * (1 - vv);
          mp.array[o + 2] = mastZ + cz * chord * uu - sx * camber;
        }
      }
      mp.needsUpdate = true; this.main.geometry.computeVertexNormals();
    }
    // jib (roller furled)
    const jp = this.jib.geometry.attributes.position, JU = 6, JV = 10, jh = this.jibHoist;
    this.jib.visible = jh > 0.03;
    if (this.jib.visible) {
      const jang = clamp(this.boom * 0.85, -1.0, 1.0), jsx = Math.sin(jang), jcz = Math.cos(jang);
      const Tx = 0, Ty = 1.6, Tz = -6.1, Hx = 0, Hy = 12.6, Hz = -1.3;
      const foot = 4.6 * jh, Cx = jsx * foot, Cy = 1.75, Cz = Tz + jcz * foot;
      for (let j = 0; j <= JV; j++) {
        const vv = j / JV, lx = lerp(Tx, Hx, vv), ly = lerp(Ty, Hy, vv), lz = lerp(Tz, Hz, vv);
        for (let i = 0; i <= JU; i++) {
          const uu = i / JU, o = (j * (JU + 1) + i) * 3, w = uu * (1 - vv);
          const camber = Math.sin(uu * Math.PI) * (1 - vv) * 0.55 * fill * jh + lf * Math.sin(t * 19 + vv * 8 + uu * 5) * 0.09 * uu * (1 - vv);
          jp.array[o] = lx + (Cx - Tx) * w + jcz * camber;
          jp.array[o + 1] = ly + (Cy - Ty) * w;
          jp.array[o + 2] = lz + (Cz - Tz) * w - jsx * camber;
        }
      }
      jp.needsUpdate = true; this.jib.geometry.computeVertexNormals();
    }
    // masthead pennant streams with the apparent wind
    const pa = this.awa + Math.PI, pp = this.pennant.geometry.attributes.position.array;
    const dxp = Math.sin(pa), dzp = -Math.cos(pa), fl = Math.min(this.aws / 6, 1);
    const top = 13.75;
    for (let k = 0; k < 3; k++) {
      const s = k * 0.42, wob = Math.sin(t * (9 + this.aws) - k * 1.8) * 0.09 * k * fl, droop = (1 - fl) * k * 0.2;
      const bx = dxp * s * fl + dzp * wob, bz = -1.1 + dzp * s * fl - dxp * wob;
      if (k < 2) { pp[k * 6] = bx; pp[k * 6 + 1] = top + 0.16 * (1 - k * 0.5) - droop; pp[k * 6 + 2] = bz; pp[k * 6 + 3] = bx; pp[k * 6 + 4] = top - 0.16 * (1 - k * 0.5) - droop; pp[k * 6 + 5] = bz; }
      else { pp[12] = bx; pp[13] = top - droop; pp[14] = bz; }
    }
    this.pennant.geometry.attributes.position.needsUpdate = true;
  }

  setNight(n) {
    this.lanternMat.emissiveIntensity = 0.2 + n * 4; this.lanternLight.intensity = n * 14; this.navMat.emissiveIntensity = n * 3;
  }
}

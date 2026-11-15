// Shared math / noise helpers
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const KNOTS = 1.94384; // m/s -> knots

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(ix, iy) {
  let h = Math.imul(ix | 0, 374761393) + Math.imul(iy | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm(x, y, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x, y);
    n += a;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    a *= 0.5;
  }
  return s / n;
}

export function ridged(x, y, oct = 4) {
  let s = 0, a = 0.5, n = 0;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(noise2(x, y) * 2 - 1);
    s += a * v * v;
    n += a;
    x = x * 2.07 + 5.3;
    y = y * 2.07 + 11.9;
    a *= 0.5;
  }
  return s / n;
}

// Tileable multi-channel noise texture used by ocean, sky and terrain shaders.
export function makeNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const tile = (x, y, p, seed) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const w = (i, j) => hash2(((i % p) + p) % p + seed * 131, ((j % p) + p) % p + seed * 71);
    const a = w(ix, iy), b = w(ix + 1, iy), c = w(ix, iy + 1), d = w(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const tfbm = (u, v, base, oct, seed) => {
    let s = 0, a = 0.5, n = 0, p = base;
    for (let i = 0; i < oct; i++) {
      s += a * tile(u * p, v * p, p, seed + i);
      n += a; a *= 0.5; p *= 2;
    }
    return s / n;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, i = (y * size + x) * 4;
      data[i] = 255 * tfbm(u, v, 4, 6, 1);      // R: broad fbm (clouds)
      data[i + 1] = 255 * tfbm(u, v, 8, 5, 2);  // G: medium fbm (foam)
      data[i + 2] = 255 * tfbm(u, v, 16, 4, 3); // B: fine fbm
      data[i + 3] = 255 * tfbm(u, v, 32, 3, 4); // A: grain
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---- small geometry toolkit (vertex-coloured, non-indexed merge) ----
const _c = new THREE.Color();
export function paint(geo, color) {
  _c.set(color);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = _c.r; arr[i * 3 + 1] = _c.g; arr[i * 3 + 2] = _c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

export function mergeGeos(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nor.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    else col.fill(1, o * 3, (o + n) * 3);
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

export function box(w, h, d, color) { return paint(new THREE.BoxGeometry(w, h, d), color); }
export function cyl(rt, rb, h, seg, color) { return paint(new THREE.CylinderGeometry(rt, rb, h, seg), color); }
export function place(geo, x, y, z, ry = 0, rx = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (rz) geo.rotateZ(rz);
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

// bearing (0 = north / -Z, clockwise) helpers
export const bearingVec = (b) => ({ x: Math.sin(b), z: -Math.cos(b) });
export const bearingTo = (x0, z0, x1, z1) => Math.atan2(x1 - x0, -(z1 - z0));
export const compassName = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export function fmtTime(hours) {
  const h = Math.floor(hours) % 24, m = Math.floor((hours % 1) * 60);
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

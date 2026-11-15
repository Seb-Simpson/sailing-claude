// Gerstner-wave ocean: GPU surface + matching CPU sampler for buoyancy
import * as THREE from 'three';
import { WORLD_SIZE } from './config.js';
import { SKY_GLSL } from './sky.js';

const G = 9.81;
// [bearing deg, wavelength m, amplitude m @ scale 1]
const WAVE_DEFS = [
  [200, 62, 0.55], [255, 41, 0.36], [155, 27, 0.22], [230, 17, 0.13], [110, 11, 0.08], [290, 7, 0.05],
];
const DETAIL_DEFS = [
  [215, 4.7, 0.030], [140, 3.4, 0.024], [275, 2.5, 0.019], [180, 1.8, 0.014],
  [60, 1.3, 0.010], [320, 0.95, 0.008], [240, 0.7, 0.006], [100, 0.5, 0.0045],
];
const toWave = ([deg, L, A], i) => {
  const a = (deg * Math.PI) / 180, k = (2 * Math.PI) / L;
  return { dx: Math.sin(a), dz: -Math.cos(a), k, A, w: Math.sqrt(G * k), ph: i * 1.7, L };
};
export const WAVES = WAVE_DEFS.map(toWave);
const DETAIL = DETAIL_DEFS.map((d, i) => toWave(d, i + 6));
const QSTEEP = 0.8;

export class Ocean {
  constructor(shared, heightTex, heightSampler, noiseTex, quality) {
    this.shared = shared;
    this.heightAt = heightSampler; // terrain height
    this.time = 0;
    this.scale = 0.7;
    this.wakeSize = 180;
    this.uniforms = {
      ...shared,
      uTime: { value: 0 },
      uWaves: { value: WAVES.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A)) },
      uDetail: { value: DETAIL.map((w) => new THREE.Vector4(w.dx, w.dz, w.k, w.A)) },
      uWaveScale: { value: 0.7 },
      uChop: { value: 0.7 },
      uFoamAmt: { value: 0.2 },
      uCenter: { value: new THREE.Vector3() },
      uHeightMap: { value: heightTex },
      uNoise: { value: noiseTex },
      uWorldSize: { value: WORLD_SIZE },
      uLod: { value: 6 },
      uDeep: { value: new THREE.Color(0x06263f) },
      uShallow: { value: new THREE.Color(0x1fb8a8) },
      uScatter: { value: new THREE.Color(0x1a9c8c) },
      uWakeTex: { value: null },
      uWakeCenter: { value: new THREE.Vector2() },
      uWakeSize: { value: this.wakeSize },
      uRain: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: true,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.setQuality(quality);
  }

  setQuality(q) {
    const cfg = [{ g: 1.05, s: 144, lod: 3.2 }, { g: 1.034, s: 224, lod: 4.6 }, { g: 1.025, s: 288, lod: 6 }][q];
    const R0 = 1.2, RMAX = 13000;
    const radii = [0];
    for (let r = R0; r < RMAX; r *= cfg.g) radii.push(r);
    radii.push(RMAX);
    const S = cfg.s, pos = new Float32Array((1 + (radii.length - 1) * S) * 3), idx = [];
    let v = 1;
    for (let ri = 1; ri < radii.length; ri++) {
      const off = (ri % 2) * 0.5;
      for (let s = 0; s < S; s++) {
        const a = ((s + off) / S) * Math.PI * 2;
        pos[v * 3] = Math.cos(a) * radii[ri]; pos[v * 3 + 2] = Math.sin(a) * radii[ri]; v++;
      }
    }
    for (let s = 0; s < S; s++) idx.push(0, 1 + ((s + 1) % S), 1 + s);
    for (let ri = 1; ri < radii.length - 1; ri++) {
      const a0 = 1 + (ri - 1) * S, b0 = a0 + S;
      for (let s = 0; s < S; s++) {
        const s1 = (s + 1) % S;
        if (ri % 2) idx.push(a0 + s, a0 + s1, b0 + s1, a0 + s, b0 + s1, b0 + s);
        else idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.uniforms.uLod.value = cfg.lod;
  }

  update(dt, camera, env) {
    this.time += dt;
    this.scale = env.waveScale;
    const u = this.uniforms;
    u.uTime.value = this.time;
    u.uWaveScale.value = env.waveScale;
    u.uChop.value = env.chop;
    u.uFoamAmt.value = env.foam;
    u.uRain.value = env.rain;
    u.uCenter.value.set(camera.position.x, 0, camera.position.z);
  }

  // shallow-water attenuation, matches the shader
  _att(x, z) {
    const d = -this.heightAt(x, z);
    let t = (d - 0.5) / 13.5; t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t);
    return 0.12 + 0.88 * t;
  }

  // Surface height at world (x,z). Iterates to undo Gerstner horizontal displacement.
  height(x, z, out) {
    const t = this.time, sc = this.scale * this._att(x, z);
    let px = x, pz = z, y = 0;
    for (let it = 0; it < 3; it++) {
      let ox = 0, oz = 0; y = 0;
      for (let i = 0; i < WAVES.length; i++) {
        const w = WAVES[i], A = w.A * sc;
        const f = w.k * (w.dx * px + w.dz * pz) - w.w * t + w.ph;
        const c = Math.cos(f);
        ox += w.dx * QSTEEP * A * c; oz += w.dz * QSTEEP * A * c; y += A * Math.sin(f);
      }
      px = x - ox; pz = z - oz;
    }
    if (out) { // also provide surface normal (approx)
      let nx = 0, nz = 0;
      for (let i = 0; i < WAVES.length; i++) {
        const w = WAVES[i], A = w.A * sc;
        const c = Math.cos(w.k * (w.dx * px + w.dz * pz) - w.w * t + w.ph) * w.k * A;
        nx -= w.dx * c; nz -= w.dz * c;
      }
      out.set(nx, 1, nz).normalize();
    }
    return y;
  }
}

const WAVE_FN = /* glsl */ `
#define NW 6
#define ND 8
uniform float uTime;
uniform vec4 uWaves[NW];
uniform vec4 uDetail[ND];
uniform float uWaveScale;
uniform float uChop;
uniform sampler2D uHeightMap;
uniform float uWorldSize;
float terrainH(vec2 xz){ return texture2D(uHeightMap, xz / uWorldSize + 0.5).r; }
float shallowAtt(float terr){ return mix(0.12, 1.0, smoothstep(0.5, 14.0, -terr)); }
`;

const VERT = /* glsl */ `
${WAVE_FN}
uniform vec3 uCenter;
uniform float uLod;
varying vec3 vWorldPos;
varying vec2 vXZ0;
varying float vAtt;
void main(){
  vec2 xz = position.xz + uCenter.xz;
  float dist = length(position.xz);
  float att = shallowAtt(terrainH(xz));
  vec3 p = vec3(xz.x, 0.0, xz.y);
  for(int i=0;i<NW;i++){
    vec4 w = uWaves[i];
    float L = 6.2831853 / w.z;
    float fade = 1.0 - smoothstep(L*uLod, L*uLod*2.2, dist);
    float A = w.w * uWaveScale * att * fade;
    float f = w.z * dot(w.xy, xz) - sqrt(9.81*w.z)*uTime + float(i)*1.7;
    p.xz += w.xy * (${QSTEEP.toFixed(2)} * A * cos(f));
    p.y += A * sin(f);
  }
  vWorldPos = p; vXZ0 = xz; vAtt = att;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
${WAVE_FN}
${SKY_GLSL}
uniform sampler2D uNoise;
uniform sampler2D uWakeTex;
uniform vec2 uWakeCenter;
uniform float uWakeSize;
uniform float uFoamAmt;
uniform float uRain;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uScatter;
uniform float uFogDensity;
uniform vec3 uAmbient;
uniform float uFlash;
varying vec3 vWorldPos;
varying vec2 vXZ0;
varying float vAtt;

void main(){
  vec3 toCam = cameraPosition - vWorldPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 xz = vXZ0;
  float terr = terrainH(vWorldPos.xz);
  float depth = -terr;
  float att = shallowAtt(terrainH(xz));

  // --- analytic normal from the same wave set (+ fine detail waves) ---
  vec2 slope = vec2(0.0);
  float h = 0.0, pinch = 0.0, amp = 0.0;
  for(int i=0;i<NW;i++){
    vec4 w = uWaves[i];
    float L = 6.2831853 / w.z;
    float fade = 1.0 - smoothstep(L*45.0, L*190.0, dist);
    float A = w.w * uWaveScale * att;
    float f = w.z * dot(w.xy, xz) - sqrt(9.81*w.z)*uTime + float(i)*1.7;
    float s = sin(f), c = cos(f);
    slope += w.xy * (w.z * A * c) * fade;
    pinch += w.z * A * s;
    h += A * s; amp += A;
  }
  for(int i=0;i<ND;i++){
    vec4 w = uDetail[i];
    float L = 6.2831853 / w.z;
    float fade = 1.0 - smoothstep(L*40.0, L*170.0, dist);
    float A = w.w * uChop * att;
    float f = w.z * dot(w.xy, xz) - sqrt(9.81*w.z)*uTime + float(i)*2.3;
    slope += w.xy * (w.z * A * cos(f)) * fade;
  }
  // micro ripples
  float mfade = 1.0 - smoothstep(18.0, 170.0, dist);
  vec2 nuv = mat2(0.8, -0.6, 0.6, 0.8) * xz;
  vec2 far1 = texture2D(uNoise, xz*0.0021 + uTime*vec2(0.003,0.002)).rg - 0.5;
  vec2 m1 = texture2D(uNoise, nuv * 0.039 + uTime*vec2(0.008, 0.013)).ba;
  vec2 m2 = texture2D(uNoise, xz.yx * 0.137 - uTime*vec2(0.021, 0.009)).ab;
  float gustP = clamp(0.55 + far1.x * 2.2 + (m1.x - 0.5), 0.15, 1.3); // cat's paws
  slope += ((m1 - 0.5) * 1.3 + (m2 - 0.5) * 0.8) * (0.10 + 0.13*uChop + 0.25*uRain) * mfade * gustP;
  // long-range variation so the far sea is not a mirror
  slope += far1 * 0.16 * smoothstep(150.0, 1500.0, dist) * (0.5 + uChop);

  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  float NdV = max(dot(N, V), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  fres = mix(fres, 0.55, smoothstep(600.0, 6000.0, dist) * 0.6);

  // --- reflection ---
  vec3 R = reflect(-V, N);
  R.y = abs(R.y) + 0.03;
  R = normalize(R);
  vec3 refl = skyBase(R);
  refl = mix(refl, uCloudColor * 0.9, uCloudCover * 0.55 * smoothstep(0.0, 0.5, R.y));
  // sun / moon glitter
  vec3 Hh = normalize(V + uLightDir);
  float rough = mix(900.0, 90.0, clamp(uChop*0.5 + smoothstep(100.0, 3000.0, dist)*0.7, 0.0, 1.0));
  float spec = pow(max(dot(N, Hh), 0.0), rough) * (rough + 8.0) * 0.04;
  refl += uLightColor * spec * uLightVis * 2.2;

  // --- water body ---
  float light = clamp(dot(uAmbient, vec3(0.333)) * 1.6, 0.0, 1.5);
  float shallowMix = exp(-max(depth, 0.0) * 0.16);
  vec3 body = mix(uDeep, uShallow, shallowMix * 0.85);
  vec3 lightCol = uAmbient * 1.5 + uLightColor * uLightVis * (0.25 + 0.5*max(dot(N, uLightDir), 0.0));
  body *= lightCol;
  // forward scattering through wave crests
  float crest = clamp(h / max(amp, 0.05) * 0.5 + 0.5, 0.0, 1.0);
  vec3 Lf = normalize(vec3(uLightDir.x, 0.0, uLightDir.z) + vec3(1e-4));
  float sss = pow(max(dot(-V, Lf), 0.0), 3.0) * crest * crest + 0.25 * crest * crest * max(uLightDir.y, 0.0);
  body += uScatter * uLightColor * uLightVis * sss * 0.55 * (0.5 + 0.5*uWaveScale);
  // sandy bottom showing through in the shallows
  body += vec3(0.75, 0.68, 0.45) * lightCol * shallowMix * shallowMix * 0.22;

  vec3 col = mix(body, refl, fres);

  // --- foam ---
  float fn1 = texture2D(uNoise, xz*0.035 + uTime*vec2(0.006, 0.004)).g;
  float fn2 = texture2D(uNoise, xz*0.19 - uTime*vec2(0.01, 0.016)).b;
  float fn = fn1 * 0.6 + fn2 * 0.4;
  float capMask = smoothstep(0.34, 0.62, pinch + (fn - 0.5) * 0.35 + uFoamAmt * 0.3 - 0.22);
  float foam = capMask * smoothstep(0.38, 0.62, fn2 + capMask*0.25) * uFoamAmt * (1.0 - smoothstep(900.0, 3500.0, dist));
  // streaks of old foam in strong wind
  foam += smoothstep(0.66, 0.8, fn1 * (0.6 + 0.4*fn2) + uFoamAmt*0.12) * uFoamAmt * 0.35 * mfade;
  // shoreline surf
  float sd = max(depth, 0.0);
  float band = 1.0 - smoothstep(0.0, 3.2, sd);
  float lines = sin(sd * 2.6 - uTime * 1.3 + fn1 * 9.0) * 0.5 + 0.5;
  float shore = band * smoothstep(0.35, 0.8, lines * (0.45 + fn2) + band * 0.55 - 0.25);
  shore *= step(-0.6, depth);
  foam += shore * (0.55 + 0.45*uWaveScale);
  // boat wake
  vec2 wuv = (vWorldPos.xz - uWakeCenter) * vec2(1.0, -1.0) / uWakeSize + 0.5;
  vec2 we = smoothstep(vec2(0.0), vec2(0.06), wuv) * smoothstep(vec2(0.0), vec2(0.06), 1.0 - wuv);
  float wake = texture2D(uWakeTex, wuv).r * we.x * we.y;
  foam += wake * (0.35 + 0.9 * smoothstep(0.25, 0.75, fn2 + wake*0.4));
  foam = clamp(foam, 0.0, 1.0);
  vec3 foamCol = (uAmbient * 2.2 + uLightColor * uLightVis * 0.75) * vec3(0.95, 0.98, 1.0);
  col = mix(col, foamCol, foam * 0.92);
  col += uFlash * vec3(0.5, 0.55, 0.7) * 0.25;

  // soft shoreline
  float alpha = max(smoothstep(-0.15, 1.3, depth), foam * 0.9);

  // --- fog into the horizon ---
  float fogF = 1.0 - exp(-pow(dist * uFogDensity, 2.0));
  vec3 fogDir = normalize(vec3(-V.x, 0.015, -V.z));
  vec3 fogCol = mix(skyBase(fogDir), uCloudColor * 0.85, uCloudCover * 0.35);
  col = mix(col, fogCol, fogF);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// Sky dome, sun/moon/stars/clouds and scene lighting driven by time of day + weather
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep } from './util.js';

// GLSL shared by the sky dome and the ocean reflection
export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlowColor;
uniform float uGlowAmt;
uniform float uNight;
uniform float uCloudCover;
uniform vec3 uCloudColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uLightVis;
vec3 skyBase(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.45));
  float sd = max(dot(d, uSunDir), 0.0);
  float low = 1.0 - h;
  c += uGlowColor * (pow(sd, 5.0) * 0.30 * low * low + pow(sd, 40.0) * 0.45) * uGlowAmt;
  float md = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.22, 0.30, 0.46) * pow(md, 20.0) * 0.10 * uNight;
  return c;
}`;

const VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;

const FRAG = /* glsl */ `
${SKY_GLSL}
uniform sampler2D uNoise;
uniform vec2 uCloudOffset;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec3 uSunDisc;
uniform float uTime;
uniform float uFlash;
uniform float uAurora;
varying vec3 vDir;
float hash13(vec3 p){ p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyBase(d);

  // stars
  if(uNight > 0.01 && d.y > -0.02){
    vec3 p = d * 190.0; vec3 ip = floor(p); vec3 fp = fract(p) - 0.5;
    float r = hash13(ip);
    float tw = 0.7 + 0.3 * sin(uTime * (1.5 + r * 4.0) + r * 60.0);
    float star = step(0.986, r) * smoothstep(0.24, 0.02, length(fp)) * tw;
    vec3 sc = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), hash13(ip + 7.0));
    col += sc * star * uNight * 1.6 * smoothstep(0.0, 0.25, d.y) * (0.4 + 2.0 * fract(r * 71.0));
    // faint milky band
    float band = exp(-pow(dot(d, normalize(vec3(0.5, 0.25, -0.83))) * 3.2, 2.0));
    col += vec3(0.05, 0.06, 0.10) * band * uNight * texture2D(uNoise, d.xz * 1.5 + d.y).r * 1.4;
  }
  // northern lights (story moments)
  if(uAurora > 0.01 && d.y > 0.02){
    float az = atan(d.x, -d.z), el = asin(d.y);
    float wob = texture2D(uNoise, vec2(az * 0.12 + uTime * 0.003, 0.37)).r;
    for(int k = 0; k < 2; k++){
      float fk = float(k);
      float c = 0.24 + fk * 0.16 + 0.11 * sin(az * (2.2 + fk) + wob * 7.0 + uTime * (0.07 + fk * 0.03));
      float up = el - c;
      float prof = up > 0.0 ? exp(-up / (0.16 + 0.1 * wob)) : exp(-pow(up / 0.025, 2.0));
      float rays = 0.45 + 0.55 * texture2D(uNoise, vec2(az * 1.9 + fk * 0.4, uTime * 0.012 + fk * 0.5)).g
                 * (0.6 + 0.4 * sin(az * 90.0 + wob * 30.0 + uTime * 0.6));
      float mask = smoothstep(1.7, 0.5, abs(az)) * smoothstep(0.02, 0.12, el);
      vec3 ac = mix(vec3(0.12, 0.95, 0.5), vec3(0.45, 0.25, 0.9), clamp(up * 3.2, 0.0, 1.0));
      col += ac * prof * rays * mask * uAurora * (0.42 - fk * 0.14);
    }
  }

  // sun & moon discs
  float sd = dot(d, uSunDir);
  vec3 disc = uSunDisc * (smoothstep(0.99935, 0.9996, sd) * 14.0 + pow(max(sd, 0.0), 900.0) * 3.0);
  float md = dot(d, uMoonDir);
  float moonMask = smoothstep(0.99955, 0.9997, md);
  float crater = texture2D(uNoise, d.xy * 9.0 + d.z * 4.0).g;
  disc += vec3(0.85, 0.9, 1.0) * moonMask * (0.75 + 0.5 * crater) * 1.7 * smoothstep(-0.05, 0.05, uMoonDir.y);

  // clouds
  float dens = 0.0; vec3 ccol = vec3(0.0);
  if(d.y > -0.01){
    vec2 uv = d.xz / (d.y + 0.14) * 0.11 + uCloudOffset;
    float n = texture2D(uNoise, uv).r * 0.58 + texture2D(uNoise, uv * 2.6 + uCloudOffset * 0.7).g * 0.28
            + texture2D(uNoise, uv * 6.7 - uCloudOffset).b * 0.14;
    float lo = mix(0.80, 0.24, uCloudCover);
    dens = smoothstep(lo, lo + 0.20, n) * smoothstep(-0.01, 0.13, d.y);
    vec2 ld = normalize(uLightDir.xz + vec2(1e-4)) * 0.018;
    float n2 = texture2D(uNoise, uv + ld).r * 0.58 + texture2D(uNoise, (uv + ld) * 2.6 + uCloudOffset * 0.7).g * 0.28;
    float lit = clamp(0.55 + (n - n2 / 0.86 * 1.0) * 5.0, 0.0, 1.0);
    lit = mix(lit, lit * 0.6, smoothstep(lo + 0.1, lo + 0.4, n));
    ccol = mix(uCloudDark, uCloudLit, lit);
    ccol += uGlowColor * pow(max(sd, 0.0), 10.0) * uGlowAmt * (1.0 - dens * 0.6) * 0.5;
    ccol += uFlash * vec3(0.8, 0.85, 1.0) * (0.4 + n);
    ccol = mix(ccol, skyBase(vec3(d.x, 0.0, d.z)), 1.0 - smoothstep(0.0, 0.22, d.y)); // haze
  }
  col += disc * (1.0 - dens);
  col = mix(col, ccol, dens * 0.96);
  col += uFlash * vec3(0.3, 0.33, 0.45) * 0.4;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const C = (r, g, b) => new THREE.Color(r, g, b);
const NIGHT_Z = C(0.006, 0.011, 0.034), DAY_Z = C(0.10, 0.29, 0.72), SET_Z = C(0.17, 0.17, 0.42);
const NIGHT_H = C(0.018, 0.03, 0.065), DAY_H = C(0.56, 0.75, 0.94), SET_H = C(1.0, 0.47, 0.19);
const tmp = new THREE.Color(), tmp2 = new THREE.Color();

export class Sky {
  constructor(noiseTex) {
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.lightDir = new THREE.Vector3(0, 1, 0);
    this.day = 1; this.night = 0; this.sunset = 0;
    this.flash = 0;
    this.shared = {
      uSunDir: { value: this.sunDir }, uMoonDir: { value: this.moonDir },
      uZenith: { value: C(0, 0, 0) }, uHorizon: { value: C(0, 0, 0) },
      uGlowColor: { value: C(1, 0.8, 0.6) }, uGlowAmt: { value: 1 }, uNight: { value: 0 },
      uCloudCover: { value: 0.3 }, uCloudColor: { value: C(1, 1, 1) },
      uLightDir: { value: this.lightDir }, uLightColor: { value: C(1, 1, 1) }, uLightVis: { value: 1 },
      uFogDensity: { value: 0.00026 }, uAmbient: { value: C(0.4, 0.5, 0.6) }, uFlash: { value: 0 },
    };
    this.uniforms = {
      ...this.shared,
      uNoise: { value: noiseTex }, uCloudOffset: { value: new THREE.Vector2() },
      uCloudLit: { value: C(1, 1, 1) }, uCloudDark: { value: C(0.5, 0.5, 0.5) },
      uSunDisc: { value: C(1, 1, 1) }, uTime: { value: 0 }, uAurora: { value: 0 },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    const sc = this.sunLight.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 160;
    this.sunLight.shadow.bias = -0.0008;
    this.sunLight.shadow.normalBias = 0.05;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.fogColor = new THREE.Color();
    this.time = 0;
  }

  update(dt, hour, wx, focus) {
    this.time += dt;
    const a = (hour / 24) * TAU - Math.PI / 2;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.86, Math.sin(a) * 0.40 + 0.06).normalize();
    this.moonDir.set(-this.sunDir.x * 0.9 + 0.2, -this.sunDir.y + 0.12, -this.sunDir.z + 0.3).normalize();
    const e = this.sunDir.y;
    const day = smoothstep(-0.12, 0.24, e);
    const night = 1 - smoothstep(-0.24, -0.02, e);
    const set = Math.exp(-Math.pow(e / 0.21, 2)) * (1 - night * 0.85);
    const grey = smoothstep(0.5, 1.0, wx.cloud) * 0.88;
    const storm = wx.storm;
    const level = 0.05 + 0.95 * day;
    this.day = day; this.night = night; this.sunset = set;
    const U = this.uniforms;

    U.uZenith.value.copy(NIGHT_Z).lerp(DAY_Z, day).lerp(SET_Z, set * 0.55);
    U.uHorizon.value.copy(NIGHT_H).lerp(DAY_H, day).lerp(SET_H, set * 0.72);
    tmp.setRGB(0.30, 0.34, 0.40).multiplyScalar(level * (1 - 0.6 * storm));
    U.uZenith.value.lerp(tmp, grey);
    tmp.setRGB(0.52, 0.56, 0.60).multiplyScalar(level * (1 - 0.55 * storm));
    U.uHorizon.value.lerp(tmp, grey * 0.95);
    // weather fog whitens the horizon
    tmp.setRGB(0.62, 0.66, 0.70).multiplyScalar(level);
    U.uHorizon.value.lerp(tmp, wx.fog * 0.8); U.uZenith.value.lerp(tmp, wx.fog * 0.45);

    U.uGlowColor.value.setRGB(1, 0.88, 0.68).lerp(tmp.setRGB(1.0, 0.42, 0.14), set);
    U.uGlowAmt.value = (1 - grey) * (1 - night) * (0.55 + 0.6 * set) * (1 - wx.fog * 0.7);
    U.uNight.value = night * (1 - grey * 0.9);
    U.uCloudCover.value = wx.cloud;
    U.uSunDisc.value.setRGB(1, 0.95, 0.85).lerp(tmp.setRGB(1.0, 0.5, 0.2), set).multiplyScalar(smoothstep(-0.06, 0.02, e));

    // direct light: sun by day, moon by night
    const sunI = smoothstep(-0.03, 0.14, e) * (1 - 0.82 * grey) * (1 - wx.fog * 0.6);
    const moonUp = smoothstep(-0.02, 0.15, this.moonDir.y);
    const moonI = 0.17 * night * moonUp * (1 - 0.8 * grey);
    const lc = U.uLightColor.value;
    if (sunI >= moonI) {
      this.lightDir.copy(this.sunDir);
      lc.setRGB(1, 0.95, 0.86).lerp(tmp.setRGB(1.0, 0.52, 0.24), clamp(set * 1.1, 0, 1)).multiplyScalar(sunI * 1.15);
    } else {
      this.lightDir.copy(this.moonDir);
      lc.setRGB(0.55, 0.68, 1.0).multiplyScalar(moonI);
    }
    if (this.lightDir.y < 0.04) { this.lightDir.y = 0.04; this.lightDir.normalize(); }
    U.uLightVis.value = 1;

    // ambient
    const amb = U.uAmbient.value;
    amb.setRGB(0.022, 0.032, 0.06).lerp(tmp.setRGB(0.36, 0.44, 0.56), day).lerp(tmp.setRGB(0.42, 0.30, 0.30), set * 0.5 * (1 - grey));
    amb.lerp(tmp.setRGB(0.34, 0.36, 0.39).multiplyScalar(level), grey * 0.8);
    amb.multiplyScalar(1 - 0.45 * storm);
    this.flash = Math.max(0, this.flash - dt * 3.2);
    const fl = this.flash * this.flash;
    U.uFlash.value = fl;
    amb.r += fl * 0.5; amb.g += fl * 0.55; amb.b += fl * 0.7;

    // clouds
    tmp.copy(lc).multiplyScalar(0.75).add(tmp2.copy(amb).multiplyScalar(1.5));
    U.uCloudLit.value.copy(tmp).multiplyScalar(1 - 0.5 * storm);
    U.uCloudDark.value.copy(amb).multiplyScalar(1.15 * (1 - 0.5 * grey) * (1 - 0.45 * storm));
    U.uCloudDark.value.lerp(tmp.copy(U.uHorizon.value), set * 0.35);
    U.uCloudColor.value.copy(U.uCloudDark.value).lerp(U.uCloudLit.value, 0.45);
    U.uCloudOffset.value.x += wx.wind.vx * dt * 0.00011;
    U.uCloudOffset.value.y += wx.wind.vz * dt * 0.00011;
    U.uTime.value = this.time;

    U.uFogDensity.value = 0.00025 + wx.fog * 0.0042 + wx.rain * 0.0007 + storm * 0.0004;
    this.fogColor.copy(U.uHorizon.value).lerp(U.uCloudColor.value, wx.cloud * 0.3);

    // three.js lights
    this.sunLight.color.copy(lc); this.sunLight.intensity = 3.1;
    this.sunLight.position.copy(focus).addScaledVector(this.lightDir, 70);
    this.sunLight.target.position.copy(focus);
    this.sunLight.target.updateMatrixWorld();
    this.hemi.color.copy(amb).multiplyScalar(3.0);
    this.hemi.groundColor.copy(amb).multiplyScalar(1.3).lerp(tmp.setRGB(0.25, 0.2, 0.12).multiplyScalar(level), 0.35);
    this.hemi.intensity = 1;
  }
}

// Weather state machine, wind field, rain and lightning
import * as THREE from 'three';
import { TAU, clamp, lerp, noise2, wrapAngle, mulberry32 } from './util.js';

export const WEATHER = {
  clear:    { label: 'Clear skies',   icon: '☀', cloud: 0.10, wind: [4.5, 7],  wave: 0.55, rain: 0,    fog: 0,   storm: 0 },
  fair:     { label: 'Fair weather',  icon: '⛅', cloud: 0.36, wind: [6, 9],    wave: 0.75, rain: 0,    fog: 0,   storm: 0 },
  breezy:   { label: 'Fresh breeze',  icon: '\u{1F343}', cloud: 0.46, wind: [9, 12.5], wave: 1.10, rain: 0, fog: 0,   storm: 0 },
  overcast: { label: 'Overcast',      icon: '☁', cloud: 0.86, wind: [5.5, 9],  wave: 0.85, rain: 0,    fog: 0.05, storm: 0 },
  rain:     { label: 'Rain',          icon: '\u{1F327}', cloud: 0.96, wind: [7.5, 12], wave: 1.15, rain: 0.65, fog: 0.08, storm: 0.15 },
  storm:    { label: 'Storm',         icon: '⛈', cloud: 1.0,  wind: [15, 20],  wave: 2.15, rain: 1,    fog: 0.1, storm: 1 },
  fog:      { label: 'Sea fog',       icon: '\u{1F32B}', cloud: 0.6, wind: [2.5, 4.5], wave: 0.4, rain: 0,   fog: 1,   storm: 0 },
};
const NEXT = {
  clear:    { clear: 2, fair: 5, breezy: 2, fog: 1 },
  fair:     { clear: 3, fair: 2, breezy: 4, overcast: 3 },
  breezy:   { fair: 4, overcast: 3, rain: 2, clear: 2 },
  overcast: { fair: 3, rain: 4, breezy: 2, fog: 1, storm: 1 },
  rain:     { overcast: 3, storm: 3, fair: 2, breezy: 1 },
  storm:    { rain: 4, overcast: 2, breezy: 2 },
  fog:      { clear: 2, fair: 3, overcast: 2 },
};

export class Weather {
  constructor(scene) {
    this.type = 'fair';
    this.timer = 200;
    this.rand = mulberry32(Date.now() & 0xffff);
    this.cur = { cloud: 0.36, windBase: 7.5, wave: 0.75, rain: 0, fog: 0, storm: 0 };
    this.tgt = { ...this.cur };
    // effective values after local overrides (the Veil etc.)
    this.cloud = 0.36; this.wave = 0.75; this.rain = 0; this.fog = 0; this.storm = 0;
    this.wind = { dir: 4.0, speed: 7, vx: 0, vz: 0, gust: 0 }; // dir = bearing wind blows FROM
    this.windDirBase = 4.0;
    this.t = this.rand() * 1000;
    this.override = null; // {type, k}
    this.onChange = null; this.onThunder = null;
    this.flashRequest = 0;
    this.lightningTimer = 6;
    this._buildRain(scene);
    this._buildBolt(scene);
    this.setType('fair', true);
  }

  setType(type, instant) {
    if (!WEATHER[type]) type = 'fair';
    const changed = type !== this.type;
    this.type = type;
    const W = WEATHER[type];
    this.tgt = { cloud: W.cloud, windBase: lerp(W.wind[0], W.wind[1], this.rand()), wave: W.wave, rain: W.rain, fog: W.fog, storm: W.storm };
    if (instant) this.cur = { ...this.tgt };
    this.timer = 170 + this.rand() * 190;
    if (type === 'storm') this.timer = 130 + this.rand() * 90;
    if (changed && this.onChange && !instant) this.onChange(type, W);
  }

  _advance() {
    const opts = NEXT[this.type];
    let total = 0; for (const k in opts) total += opts[k];
    let r = this.rand() * total;
    for (const k in opts) { r -= opts[k]; if (r <= 0) { this.setType(k); return; } }
  }

  update(dt, camera, override) {
    this.t += dt;
    this.timer -= dt;
    if (this.timer <= 0) this._advance();
    const k = 1 - Math.exp(-dt / 28);
    for (const key in this.cur) this.cur[key] = lerp(this.cur[key], this.tgt[key], k);

    // local overrides (e.g. the Veil storm wall, or the calm at Horizon's Edge)
    let c = this.cur, o = override;
    let cloud = c.cloud, wave = c.wave, rain = c.rain, fog = c.fog, storm = c.storm, wbase = c.windBase;
    if (o && o.k > 0) {
      const W = WEATHER[o.type], m = o.k;
      cloud = lerp(cloud, W.cloud, m); wave = lerp(wave, W.wave * (o.boost || 1), m); rain = lerp(rain, W.rain, m);
      fog = lerp(fog, W.fog, m); storm = lerp(storm, W.storm, m); wbase = lerp(wbase, (W.wind[0] + W.wind[1]) / 2, m);
    }
    this.cloud = cloud; this.wave = wave; this.rain = rain; this.fog = fog; this.storm = storm;

    // wind: slow veer + gusts
    this.windDirBase += (noise2(this.t * 0.004, 3.7) - 0.5) * dt * 0.035;
    const veer = (noise2(this.t * 0.03, 9.1) - 0.5) * 0.5;
    const gust = (noise2(this.t * 0.11, 1.3) - 0.5) * 0.44 + (noise2(this.t * 0.47, 5.9) - 0.5) * 0.16 * (1 + storm);
    const w = this.wind;
    w.dir = wrapAngle(this.windDirBase + veer);
    w.gust = gust;
    w.speed = Math.max(1.5, wbase * (1 + gust));
    // air moves opposite to the 'from' bearing
    w.vx = -Math.sin(w.dir) * w.speed; w.vz = Math.cos(w.dir) * w.speed;

    // rain
    const ru = this.rainMat.uniforms;
    ru.uTime.value = this.t; ru.uAmount.value = rain;
    ru.uWind.value.set(w.vx * 0.55, w.vz * 0.55);
    this.rainMesh.visible = rain > 0.02;
    this.rainMesh.position.copy(camera.position);

    // lightning
    this.boltLife -= dt;
    if (this.boltLife <= 0) this.bolt.visible = false;
    else this.bolt.material.opacity = this.boltLife > 0.12 ? 1 : (Math.sin(this.boltLife * 90) > 0 ? 0.9 : 0.25);
    if (storm > 0.55) {
      this.lightningTimer -= dt;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 3.5 + this.rand() * 11 / storm;
        this._strike(camera);
      }
    }
  }

  _strike(camera) {
    const ang = this.rand() * TAU, dist = 500 + this.rand() * 2800;
    const x = camera.position.x + Math.cos(ang) * dist, z = camera.position.z + Math.sin(ang) * dist;
    const visible = this.rand() < 0.75;
    if (visible) {
      const pts = []; let px = x, pz = z, py = 950;
      const side = new THREE.Vector3(-Math.sin(ang), 0, Math.cos(ang));
      const pos = [];
      const width = 3 + dist * 0.0035;
      const seg = (ax, ay, az, bx, by, bz, wd) => {
        pos.push(ax - side.x * wd, ay, az - side.z * wd, ax + side.x * wd, ay, az + side.z * wd, bx + side.x * wd, by, bz + side.z * wd,
                 ax - side.x * wd, ay, az - side.z * wd, bx + side.x * wd, by, bz + side.z * wd, bx - side.x * wd, by, bz - side.z * wd);
      };
      while (py > 0) {
        const ny = py - (40 + this.rand() * 70), off = (this.rand() - 0.5) * 110;
        const nx = px + side.x * off, nz = pz + side.z * off;
        seg(px, py, pz, nx, Math.max(ny, 0), nz, width);
        if (this.rand() < 0.3) { // branch
          let bx = nx, by = ny, bz = nz;
          for (let i = 0; i < 3 && by > 0; i++) {
            const o2 = (this.rand() - 0.3) * 150, cy = by - 50 - this.rand() * 40;
            const cx = bx + side.x * o2, cz = bz + side.z * o2;
            seg(bx, by, bz, cx, Math.max(cy, 0), cz, width * 0.45); bx = cx; by = cy; bz = cz;
          }
        }
        px = nx; py = ny; pz = nz; pts.push(px);
      }
      this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.bolt.geometry.computeBoundingSphere();
      this.bolt.visible = true; this.boltLife = 0.28;
    }
    this.flashRequest = visible ? 1 : 0.6;
    if (this.onThunder) this.onThunder(dist);
  }

  _buildBolt(scene) {
    this.bolt = new THREE.Mesh(new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 6.5, 9), side: THREE.DoubleSide, fog: false, transparent: true, depthWrite: false }));
    this.bolt.visible = false; this.bolt.frustumCulled = false; this.boltLife = 0;
    scene.add(this.bolt);
  }

  _buildRain(scene) {
    const N = 7000, BOX = 50;
    const pos = new Float32Array(N * 6), end = new Float32Array(N * 2);
    for (let i = 0; i < N; i++) {
      const x = Math.random() * BOX, y = Math.random() * BOX, z = Math.random() * BOX;
      pos.set([x, y, z, x, y, z], i * 6); end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(0.7, 0.78, 0.9) } },
      vertexShader: /* glsl */ `
        attribute float aEnd; uniform float uTime; uniform vec2 uWind; uniform float uAmount; varying float vA;
        void main(){
          vec3 vel = vec3(uWind.x, -24.0, uWind.y);
          vec3 p = position + vel * uTime;
          p = mod(p - cameraPosition, ${BOX}.0) - ${BOX / 2}.0;
          float keep = step(fract(position.x * 7.13 + position.z * 3.7), uAmount);
          p += vel * 0.035 * aEnd;
          vA = keep * (1.0 - smoothstep(14.0, 25.0, length(p))) * (0.25 + 0.3 * aEnd);
          gl_Position = projectionMatrix * viewMatrix * vec4(p + cameraPosition, 1.0);
        }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vA; void main(){ gl_FragColor = vec4(uColor, vA); }`,
      transparent: true, depthWrite: false,
    });
    this.rainMesh = new THREE.LineSegments(geo, this.rainMat);
    this.rainMesh.frustumCulled = false; this.rainMesh.renderOrder = 6;
    this.rainMesh.position.set(0, 0, 0);
    scene.add(this.rainMesh);
  }

  serialize() { return { type: this.type, timer: this.timer, dir: this.windDirBase }; }
  restore(s) { if (!s) return; this.setType(s.type, true); this.timer = s.timer || 120; this.windDirBase = s.dir ?? 4; }
}

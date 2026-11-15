// Wake foam (render-to-texture), spray, seabirds, dolphins and floating collectibles
import * as THREE from 'three';
import { TAU, clamp, lerp, mulberry32, mergeGeos, paint, box, cyl, place } from './util.js';

function blotchTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = mulberry32(9);
  for (let i = 0; i < 26; i++) {
    const x = 64 + (r() - 0.5) * 56, y = 64 + (r() - 0.5) * 56, rad = 10 + r() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,0.32)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return new THREE.CanvasTexture(c);
}

export class Wake {
  constructor(size = 180, res = 512) {
    this.size = size; this.MAX = 700;
    this.rt = new THREE.WebGLRenderTarget(res, res, { depthBuffer: false });
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 0.1, 100);
    this.cam.up.set(0, 0, -1); this.cam.position.set(0, 50, 0); this.cam.lookAt(0, 0, 0);
    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: blotchTexture(), transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }), this.MAX);
    this.mesh.frustumCulled = false; this.scene.add(this.mesh);
    this.p = []; this.center = new THREE.Vector2(); this.acc = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._v = new THREE.Vector3(); this._c = new THREE.Color();
    this._e = new THREE.Euler();
  }
  emit(x, z, size, life, strength, vx = 0, vz = 0, grow = 0.5) {
    if (this.p.length >= this.MAX) this.p.shift();
    this.p.push({ x, z, size, life, age: 0, k: strength, vx, vz, grow, rot: Math.random() * TAU });
  }
  fromBoat(boat, dt) {
    const sp = Math.abs(boat.speed);
    this.acc += sp * dt;
    if (this.acc > 0.75 && sp > 0.5) {
      this.acc = 0;
      const k = clamp(sp / 7, 0.12, 1), f = boat.fwd, r = boat.right, p = boat.pos;
      this.emit(p.x - f.x * 4.6 + (Math.random() - 0.5) * 0.6, p.z - f.z * 4.6 + (Math.random() - 0.5) * 0.6, 1.6 + k, 9 + k * 7, 0.55 * k + 0.1, 0, 0, 0.35);
      for (const s of [-1, 1]) {
        this.emit(p.x + f.x * 3.2 + r.x * s * 0.8, p.z + f.z * 3.2 + r.z * s * 0.8, 1.1 + k * 0.8, 5 + k * 6, 0.6 * k,
          r.x * s * (0.5 + sp * 0.14) + f.x * sp * 0.15, r.z * s * (0.5 + sp * 0.14) + f.z * sp * 0.15, 0.3);
      }
    }
  }
  update(dt, renderer, cx, cz) {
    const texel = this.size / this.rt.width;
    cx = Math.round(cx / texel) * texel; cz = Math.round(cz / texel) * texel;
    this.center.set(cx, cz);
    this.cam.position.set(cx, 50, cz); this.cam.lookAt(cx, 0, cz);
    let n = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const a = this.p[i]; a.age += dt;
      if (a.age >= a.life) { this.p.splice(i, 1); continue; }
      const damp = Math.exp(-dt * 0.8);
      a.x += a.vx * dt; a.z += a.vz * dt; a.vx *= damp; a.vz *= damp;
    }
    for (const a of this.p) {
      const t = a.age / a.life, s = a.size + a.age * a.grow;
      this._e.set(0, a.rot, 0); this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(a.x, 0, a.z), this._q, this._s.set(s, 1, s));
      this.mesh.setMatrixAt(n, this._m);
      this.mesh.setColorAt(n, this._c.setScalar(a.k * Math.pow(1 - t, 1.6) * Math.min(1, a.age * 4)));
      n++;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }
}

export class Spray {
  constructor(scene, tex) {
    this.N = 360; this.i = 0;
    this.pos = new Float32Array(this.N * 3); this.vel = new Float32Array(this.N * 3); this.life = new Float32Array(this.N); this.sz = new Float32Array(this.N);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sz, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uColor: { value: new THREE.Color(1, 1, 1) }, uScale: { value: 600 } },
      vertexShader: `attribute float aLife; attribute float aSize; uniform float uScale; varying float vA;
        void main(){ vec4 mv = viewMatrix * vec4(position, 1.0); vA = clamp(aLife * 1.6, 0.0, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.5) * step(0.001, aLife); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; varying float vA;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA * 0.5; if(a < 0.01) discard; gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.i = (this.i + 1) % this.N;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz; this.life[i] = life; this.sz[i] = size;
  }
  burst(boat, power, wind) {
    const f = boat.fwd, r = boat.right, p = boat.pos, n = Math.round(22 * power);
    for (let k = 0; k < n; k++) {
      const s = Math.random() < 0.5 ? -1 : 1, sp = Math.abs(boat.speed);
      this.emit(p.x + f.x * (3.6 + Math.random()) + r.x * s * 0.5, boat.y + 0.3, p.z + f.z * (3.6 + Math.random()) + r.z * s * 0.5,
        f.x * sp * 0.5 + r.x * s * (1.5 + Math.random() * 3) * power + wind.vx * 0.12, 2 + Math.random() * 3.6 * power, f.z * sp * 0.5 + r.z * s * (1.5 + Math.random() * 3) * power + wind.vz * 0.12,
        0.7 + Math.random() * 0.8, 0.5 + Math.random() * 0.9);
    }
  }
  splash(x, y, z, n = 14, pow = 1) {
    for (let k = 0; k < n; k++) { const a = Math.random() * TAU, s = Math.random() * 2.5 * pow; this.emit(x, y, z, Math.cos(a) * s, 2 + Math.random() * 4 * pow, Math.sin(a) * s, 0.6 + Math.random() * 0.7, 0.5 + Math.random() * 0.8); }
  }
  update(dt, color) {
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt; this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.aLife.needsUpdate = true; g.attributes.aSize.needsUpdate = true;
    this.mat.uniforms.uColor.value.copy(color);
  }
}

export class Birds {
  constructor(scene, world) {
    const homes = [];
    for (const isl of world.islands) {
      if (isl.def.hidden) continue;
      const pts = [];
      if (isl.dock) pts.push([isl.dock.x, isl.dock.z]);
      if (isl.wreck) pts.push([isl.wreck.x, isl.wreck.z]);
      if (isl.light) pts.push([isl.light.x, isl.light.z]);
      pts.push([isl.def.x + isl.def.r * 0.7, isl.def.z + isl.def.r * 0.3]);
      for (const p of pts) homes.push(p);
    }
    this.follow = { x: 0, z: 0 };
    const rand = mulberry32(77); this.b = [];
    const add = (home, n) => { for (let k = 0; k < n; k++) this.b.push({ home, R: 14 + rand() * 80, h: 9 + rand() * 30, w: (rand() < 0.5 ? -1 : 1) * (0.07 + rand() * 0.1), ph: rand() * TAU, wob: rand() * 10 }); };
    homes.forEach((h) => add({ x: h[0], z: h[1] }, 6));
    add(this.follow, 5);
    const N = this.N = this.b.length;
    const g = new THREE.InstancedBufferGeometry();
    // x, y, z, wing(0..1 signed)
    const v = [0, 0, -0.45, 0, 0, 0, 0.5, 0, -1.3, 0, -0.05, 1, 0, 0, -0.45, 0, 0, 0, 0.5, 0, 1.3, 0, -0.05, 1, -1.3, 0, -0.05, 1, -2.3, 0, 0.25, 2, 0, 0, 0.5, 0.2, 1.3, 0, -0.05, 1, 2.3, 0, 0.25, 2, 0, 0, 0.5, 0.2];
    const pos = [], wing = [];
    for (let i = 0; i < v.length; i += 4) { pos.push(v[i], v[i + 1], v[i + 2]); wing.push(v[i + 3]); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    this.ipos = new Float32Array(N * 4); this.iph = new Float32Array(N);
    for (let i = 0; i < N; i++) this.iph[i] = rand() * TAU;
    this.attr = new THREE.InstancedBufferAttribute(this.ipos, 4); this.attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aInst', this.attr);
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(this.iph, 1));
    g.instanceCount = N;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) }, uFog: { value: new THREE.Color() }, uFogDensity: { value: 0.0003 } },
      vertexShader: `attribute float aWing; attribute vec4 aInst; attribute float aPhase; uniform float uTime; varying float vShade; varying float vDist;
        void main(){ vec3 p = position * 0.62; float fl = sin(uTime * 7.5 + aPhase) * (0.5 + 0.5 * sin(uTime * 0.6 + aPhase * 3.0));
          p.y += aWing * aWing * 0.26 * fl + aWing * 0.1; float c = cos(aInst.w), s = sin(aInst.w);
          vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) + aInst.xyz; vShade = 0.72 + 0.28 * step(0.5, aWing) - 0.25 * step(1.5, aWing);
          vec4 mv = viewMatrix * vec4(w, 1.0); vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform vec3 uFog; uniform float uFogDensity; varying float vShade; varying float vDist;
        void main(){ vec3 c = mix(uColor * vShade, uFog, 1.0 - exp(-pow(vDist * uFogDensity, 2.0))); gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    this.nearest = 1e9;
  }
  update(dt, t, boat, light, fogColor, fogDensity, day) {
    this.follow.x = lerp(this.follow.x, boat.pos.x + boat.fwd.x * 20, dt * 0.2); this.follow.z = lerp(this.follow.z, boat.pos.z + boat.fwd.z * 20, dt * 0.2);
    let near = 1e9;
    for (let i = 0; i < this.N; i++) {
      const b = this.b[i], a = b.ph + t * b.w, R = b.R * (1 + 0.25 * Math.sin(t * 0.13 + b.wob));
      const x = b.home.x + Math.cos(a) * R, z = b.home.z + Math.sin(a) * R * 0.8;
      this.ipos[i * 4] = x; this.ipos[i * 4 + 1] = b.h + Math.sin(t * 0.4 + b.wob) * 3 + (1 - day) * -200; this.ipos[i * 4 + 2] = z;
      this.ipos[i * 4 + 3] = -a - (b.w > 0 ? Math.PI : 0);
      if (b.home !== this.follow) { const d = (x - boat.pos.x) ** 2 + (z - boat.pos.z) ** 2; if (d < near) near = d; }
    }
    this.nearest = Math.sqrt(near);
    this.attr.needsUpdate = true;
    const u = this.mat.uniforms; u.uTime.value = t; u.uColor.value.copy(light); u.uFog.value.copy(fogColor); u.uFogDensity.value = fogDensity;
  }
}

export class Dolphins {
  constructor(scene) {
    const body = new THREE.SphereGeometry(1, 12, 8); body.scale(0.3, 0.33, 1.25);
    const bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) { const z = bp.getZ(i); if (z > 0) { const k = 1 - (z / 1.25) * 0.55; bp.setX(i, bp.getX(i) * k); bp.setY(i, bp.getY(i) * k); } }
    const geo = mergeGeos([paint(body, 0x56677a), place(paint(new THREE.ConeGeometry(0.12, 0.4, 4), 0x48586a), 0, 0.42, 0.05, 0, -0.5),
      place(box(0.7, 0.05, 0.28, 0x48586a), 0, 0, 1.3), place(paint(new THREE.ConeGeometry(0.1, 0.5, 5), 0x56677a), 0, 0, -1.3, 0, -Math.PI / 2)]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
    this.d = [];
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(geo, mat); m.visible = false; m.rotation.order = 'YXZ'; scene.add(m); this.d.push({ m, off: 0, lat: 0, ph: 0, was: -1 }); }
    this.timer = 50 + Math.random() * 60; this.active = 0; this.pos = new THREE.Vector3(); this.dir = 0;
  }
  update(dt, boat, ocean, spray, ok, wake) {
    if (this.active <= 0) {
      this.timer -= dt;
      if (this.timer <= 0 && ok && Math.abs(boat.speed) > 2.5) {
        this.active = 26 + Math.random() * 14; this.timer = 110 + Math.random() * 170;
        const side = Math.random() < 0.5 ? -1 : 1;
        this.d.forEach((o, i) => { o.off = -14 - i * 3.2 - Math.random() * 3; o.lat = side * (5.5 + i * 1.9 + Math.random()); o.ph = Math.random() * TAU; o.m.visible = true; });
        return true;
      }
      return false;
    }
    this.active -= dt;
    const leaving = this.active < 4;
    for (const o of this.d) {
      o.off += dt * (leaving ? -3 : (o.off < 6 ? 1.6 : 0.1));
      o.ph += dt * 2.3;
      const x = boat.pos.x + boat.fwd.x * o.off + boat.right.x * o.lat, z = boat.pos.z + boat.fwd.z * o.off + boat.right.z * o.lat;
      const s = Math.sin(o.ph), y = ocean.height(x, z) + s * 1.25 - 0.7 - (leaving ? (4 - this.active) * 0.8 : 0);
      o.m.position.set(x, y, z);
      o.m.rotation.set(Math.cos(o.ph) * 0.75, -boat.heading, 0);
      const above = s > 0.56 ? 1 : 0;
      if (o.was !== above && o.was !== -1 && !leaving) { spray.splash(x, y + 0.2, z, 10, 0.8); wake.emit(x, z, 1.6, 4, 0.6, 0, 0, 0.5); }
      o.was = above;
      if (this.active <= 0) o.m.visible = false;
    }
    return false;
  }
}

// Floating collectibles
export class Flotsam {
  constructor(scene, glowTex) {
    this.scene = scene; this.items = []; this.glowTex = glowTex;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, flatShading: true });
    this.glass = new THREE.MeshStandardMaterial({ color: 0x4f9a7a, roughness: 0.15, metalness: 0.1, emissive: 0x2d7a5a, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 });
    this.geo = {
      bottle: mergeGeos([place(cyl(0.16, 0.16, 0.5, 8, 0xffffff), 0, 0, 0), place(cyl(0.06, 0.15, 0.2, 8, 0xffffff), 0, 0.35, 0), place(cyl(0.07, 0.07, 0.1, 6, 0xffffff), 0, 0.48, 0)]),
      barrel: mergeGeos([cyl(0.42, 0.42, 1.0, 10, 0x7a5533), place(cyl(0.45, 0.45, 0.08, 10, 0x2f2f33), 0, 0.3, 0), place(cyl(0.45, 0.45, 0.08, 10, 0x2f2f33), 0, -0.3, 0)]),
      crate: mergeGeos([box(1, 1, 1, 0x9a7446), box(1.06, 0.14, 1.06, 0x6b4d2c), place(box(1.06, 0.14, 1.06, 0x6b4d2c), 0, 0.4, 0), place(box(1.06, 0.14, 1.06, 0x6b4d2c), 0, -0.4, 0)]),
    };
    this._n = new THREE.Vector3();
  }
  add(item) { // {id,type,x,z}
    const m = new THREE.Mesh(this.geo[item.type], item.type === 'bottle' ? this.glass : this.mat);
    const s = item.type === 'bottle' ? 1.5 : 1.15; m.scale.setScalar(s); m.position.set(item.x, 0, item.z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: item.type === 'bottle' ? 0x9dffd8 : 0xffe2a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    glow.scale.setScalar(item.type === 'bottle' ? 3.2 : 2.6);
    this.scene.add(m); this.scene.add(glow);
    const o = { ...item, m, glow, ph: Math.random() * 10, active: true };
    this.items.push(o); return o;
  }
  setActive(o, a) { o.active = a; o.m.visible = a; o.glow.visible = a; }
  update(dt, t, boat, ocean, night) {
    let picked = null;
    for (const o of this.items) {
      if (!o.active) continue;
      const dx = o.x - boat.pos.x, dz = o.z - boat.pos.z, d2 = dx * dx + dz * dz;
      const vis = d2 < 900 * 900; o.m.visible = vis; o.glow.visible = vis;
      if (!vis) continue;
      const y = ocean.height(o.x, o.z, this._n);
      o.m.position.y = y + (o.type === 'crate' ? 0.1 : 0.05);
      if (o.type === 'bottle') o.m.rotation.set(1.1 + this._n.z, o.ph + t * 0.2, this._n.x);
      else o.m.rotation.set(this._n.z * 0.8 + (o.type === 'barrel' ? 1.45 : 0.1), o.ph, -this._n.x * 0.8);
      o.glow.position.set(o.x, y + 1.6, o.z);
      o.glow.material.opacity = (0.25 + 0.6 * night) * (0.6 + 0.4 * Math.sin(t * 3 + o.ph));
      if (d2 < 30) picked = o;
    }
    return picked;
  }
}

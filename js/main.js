// Beyond the Horizon — bootstrap, main loop, camera and input
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { TAU, DEG, KNOTS, clamp, lerp, damp, dampAngle, smoothstep, wrapAngle, makeNoiseTexture } from './util.js';
import { Sky } from './sky.js';
import { Ocean } from './ocean.js';
import { Weather } from './weather.js';
import { World } from './world.js';
import { Boat } from './boat.js';
import { Wake, Spray, Birds, Dolphins, Flotsam } from './effects.js';
import { AudioSys } from './audio.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const SETTINGS_KEY = 'beyond-the-horizon-settings-v1';
const settings = Object.assign({ quality: 2, master: 0.8, music: 0.55, sfx: 0.85, autoTrim: false, keys: true, dayLen: 20 }, (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })());
if (!localStorage.getItem(SETTINGS_KEY) && (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820)) { settings.quality = 0; settings.autoTrim = true; }
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* ignore */ } };
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const $ = (id) => document.getElementById(id);

let renderer, scene, camera, composer, bloom, sky, ocean, weather, world, boat, wake, spray, birds, dolphins, flotsam, game, ui;
const audio = new AudioSys();
let mode = 'loading', menuHour = 17.35, busy = false;
const keys = new Set();
const cam = { yaw: 0.5, pitch: 0.2, dist: 22, head: 0, mode: 0, shake: 0, target: new THREE.Vector3(), userT: 99 };
const v3 = new THREE.Vector3(), v3b = new THREE.Vector3(), col = new THREE.Color();
let resScale = 1, fpsAcc = 0, fpsN = 0, lastDrop = -1e9;
let bellT = 3, flotT = 0, nearFlotsam = [], interaction = null, simT = 0;

async function boot() {
  const canvas = $('game');
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    $('load-text').textContent = 'This voyage needs WebGL 2. Please try a recent desktop or mobile browser.'; return;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 30000);
  scene.fog = new THREE.FogExp2(0x9fb8cc, 0.00026);
  const tick = async (p, t) => { $('load-fill').style.width = Math.round(p * 100) + '%'; $('load-text').textContent = t; await frame(); await frame(); };

  await tick(0.08, 'Mixing the colours of the sea…');
  const noise = makeNoiseTexture(256);
  await tick(0.2, 'Raising islands from the deep…');
  world = new World(scene, noise, settings.quality);
  await tick(0.62, 'Filling the ocean…');
  sky = new Sky(noise); scene.add(sky.mesh, sky.sunLight, sky.sunLight.target, sky.hemi);
  ocean = new Ocean(sky.shared, world.heightTex, (x, z) => world.heightAt(x, z), noise, settings.quality);
  scene.add(ocean.mesh);
  wake = new Wake(ocean.wakeSize, 512); ocean.uniforms.uWakeTex.value = wake.rt.texture;
  await tick(0.72, 'Summoning the weather…');
  weather = new Weather(scene);
  await tick(0.8, 'Rigging the boat…');
  boat = new Boat(scene);
  spray = new Spray(scene, world.glowTex); birds = new Birds(scene, world); dolphins = new Dolphins(scene);
  flotsam = new Flotsam(scene, world.glowTex);
  game = new Game(world);
  for (const def of game.flotsamDefs) def.obj = flotsam.add(def);
  await tick(0.9, 'Unrolling the charts…');
  ui = new UI(game, world, audio, settings, {
    newGame: () => startGame(true), continueGame: () => startGame(false), quit: quitToMenu, castOff, rest, boat: () => boat,
    setting: applySetting, wipe: () => { game.wipe(); $('btn-continue').classList.add('hidden'); },
  });
  wireGame(); wireInput(canvas);
  applyQuality(); onResize(); addEventListener('resize', onResize);
  audio.vol = { master: settings.master, music: settings.music, sfx: settings.sfx };

  enterMenu();
  await tick(0.97, 'Catching the wind…');
  // warm up shaders
  step(0.016); render();
  await frame();
  ui.loaded();
  mode = 'menu';
  let last = performance.now();
  const loop = (now) => {
    const real = (now - last) / 1000, dt = Math.min(real, 0.05); last = now;
    ui.tick(Math.min(real, 0.5)); step(dt); render();
    // adaptive resolution keeps the helm responsive on slower GPUs
    fpsAcc += real; fpsN++;
    if (fpsAcc > 2 && !navigator.webdriver && !document.hidden) {
      const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
      const next = fps < 42 ? Math.max(0.55, resScale - 0.1) : fps > 57 && resScale < 1 && now - lastDrop > 45000 ? Math.min(1, resScale + 0.05) : resScale;
      if (next < resScale) lastDrop = now;
      if (next !== resScale) { resScale = next; onResize(); }
    } else if (fpsAcc > 2) { fpsAcc = 0; fpsN = 0; }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__bth = { step, keys, game, boat, weather, world, ocean, sky, ui, cam, settings, audio, setHour: (h) => { if (game.s) game.s.hour = h; menuHour = h; } };
}

// ---------- settings / quality ----------
function applyQuality() {
  const q = settings.quality;
  renderer.shadowMap.enabled = q > 0;
  sky.sunLight.castShadow = q > 0;
  if (q > 0 && !composer) {
    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.7, 1.05);
    composer.addPass(bloom); composer.addPass(new OutputPass());
  }
  onResize();
}
function applySetting(key, val) {
  saveSettings();
  if (key === 'quality') { ocean.setQuality(val); applyQuality(); scene.traverse((o) => { if (o.material && o.material.needsUpdate !== undefined) o.material.needsUpdate = true; }); }
  if (key === 'master' || key === 'music' || key === 'sfx') { audio.vol[key] = val; audio.applyVolumes(); }
  if (key === 'autoTrim') boat.autoTrim = val;
  if (key === 'keys') $('keys').classList.toggle('hidden', !val);
}
function onResize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, [1, 1.5, 2][settings.quality]) * resScale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}

// ---------- flow ----------
function placeBoatFromState() {
  const s = game.s;
  boat.teleport(s.x, s.z, s.heading);
  boat.sailLevel = s.sailLevel; boat.sheet = s.sheet; boat.anchored = s.anchored; boat.autoTrim = settings.autoTrim || s.autoTrim;
  boat.hoist = [0, 0.4, 0.72, 1][s.sailLevel]; boat.setUpgrades(s.upg, s.finished);
  cam.head = boat.heading;
}
function enterMenu() {
  mode = 'menu';
  if (!game.s) { if (!game.load()) game.newGame(); }
  const d = world.byId.haven.dock;
  boat.teleport(d.x + d.outX * 150 + d.outZ * 40, d.z + d.outZ * 150 - d.outX * 40, d.heading + 2.2);
  boat.sailLevel = 3; boat.hoist = 1; boat.anchored = false; boat.autoTrim = true; boat.setUpgrades(game.s.upg, game.s.finished);
  weather.setType('fair', true); weather.windDirBase = d.heading + 2.2 + 1.9;
  cam.mode = 0; cam.dist = 24; cam.pitch = 0.1; cam.yaw = 2.4;
  const has = game.hasSave(), s = game.s;
  ui.showMenu(has, has ? `Day ${s.day} · ${game.rank().name} · ${game.beaconCount}/5 beacons` : '');
}
async function startGame(fresh) {
  if (busy) return; busy = true;
  audio.init(); audio.applyVolumes();
  ui.fade(true); await wait(950);
  if (fresh) { game.wipe(); game.newGame(); } else if (!game.load()) game.newGame();
  const s = game.s;
  placeBoatFromState();
  if (fresh) { weather.setType('fair', true); weather.windDirBase = s.heading + 1.75; weather.timer = 420; }
  else weather.restore(s.weather);
  for (const def of game.flotsamDefs) flotsam.setActive(def.obj, game.flotsamActive(def));
  cam.mode = 0; cam.dist = 22; cam.pitch = 0.2; cam.yaw = 0.45; cam.userT = 99;
  mode = 'play'; ui.showGame();
  ui.fade(false);
  if (s.docked) { boat.sailLevel = 0; boat.anchored = true; ui.openHarbour(s.docked); }
  if (fresh) ui.story({ kicker: 'Port Haven · Dawn', title: 'A boat of your own', delay: 1.4, button: 'Cast off',
    text: 'The Marigold’s old tender is yours now — thirty feet of patched oak and a sail the colour of weak tea.\n\nBeyond the harbour wall the sea runs out to a line that no one in Port Haven has ever crossed. They say five ancient beacons once showed the way.\n\nFirst things first. Learn the wind.' });
  busy = false;
}
async function quitToMenu() {
  if (busy) return; busy = true;
  game.save(boat, weather);
  ui.fade(true); await wait(900);
  enterMenu(); ui.fade(false); busy = false;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function dock(id) {
  if (busy) return; busy = true;
  audio.bell(392, 0.2); ui.fade(true); await wait(800);
  const s = game.s, d = world.byId[id].dock;
  boat.teleport(d.berthX, d.berthZ, d.heading); boat.setSail(0); boat.anchored = true; boat.hoist = 0;
  s.docked = id; s.lastHarbour = id; cam.head = boat.heading; cam.yaw = 0.9; cam.pitch = 0.16; cam.dist = 20;
  game.deliver(id); game.save(boat, weather);
  ui.openHarbour(id); ui.fade(false); busy = false;
}
function castOff() {
  const s = game.s; if (!s.docked) return;
  const d = world.byId[s.docked].dock;
  // point the bow somewhere she can actually sail
  let h = d.heading; const rel = wrapAngle(weather.wind.dir - h);
  if (Math.abs(rel) < 0.95) h = wrapAngle(weather.wind.dir - Math.sign(rel || 1) * 1.0);
  boat.teleport(d.berthX, d.berthZ, h); cam.head = h;
  s.docked = null; ui.closeHarbour(); audio.rope(); game.save(boat, weather);
  ui.toast('Lines away. Raise sail with E.', '');
}
async function rest() {
  if (busy) return; busy = true;
  ui.fade(true); await wait(900);
  game.rest(); weather.setType(Math.random() < 0.5 ? 'clear' : 'fair', true);
  ui._renderHarbour(); $('hb-msg').textContent = 'You wake to gulls and the smell of fresh bread. A new day.';
  game.save(boat, weather); ui.fade(false); busy = false;
}

function wireGame() {
  game.on((type, d) => {
    if (type === 'toast') { ui.toast(d.text, d.kind); if (d.kind === 'gold') audio.pickup(); if (d.kind === 'warn') audio.warn(); }
    else if (type === 'discover') { ui.banner(d.name, d.blurb); audio.discover(); game.save(boat, weather); }
    else if (type === 'story') ui.story(d);
    else if (type === 'quest') { setTimeout(() => { ui.banner(d.title, '', 'New course'); audio.quest(); }, 600); }
    else if (type === 'sfx') audio[d.name] && audio[d.name]();
    else if (type === 'upgrade') boat.setUpgrades(game.s.upg, game.s.finished);
    else if (type === 'damage') { audio.thud(); cam.shake = Math.min(1, 0.3 + d.amount * 0.05); if (d.why === 'knockdown') ui.toast('Knocked down! Too much sail for this wind.', 'warn'); }
    else if (type === 'wrecked') shipwreck();
    else if (type === 'ending') ending();
  });
  boat.onDamage = (n, why) => game.damage(n, why);
  boat.onSlam = (p) => { spray.burst(boat, p, weather.wind); audio.splash(p); };
  weather.onChange = (type, W) => {
    if (mode !== 'play') return;
    if (type === 'storm') { ui.toast('The sky is turning black. A storm is coming — reef your sails.', 'warn'); game.s.stats.storms++; }
    else ui.toast(`Weather: ${W.label}`, '');
  };
  weather.onThunder = (dist) => { audio.thunder(dist); cam.shake = Math.max(cam.shake, clamp(0.5 - dist / 3000, 0, 0.4)); };
}
async function shipwreck() {
  if (busy) return; busy = true;
  audio.thud(); ui.fade(true); await wait(1200);
  const lost = game.shipwreck(); placeBoatFromState(); boat.setSail(0); boat.anchored = true; weather.setType('fair', true);
  game.save(boat, weather);
  ui.story({ kicker: 'Shipwrecked', title: 'Hauled from the sea', text: `The hull gives way with a sound like a slammed door.\n\nYou wake under a fisherman’s blanket at ${world.byId[game.s.lastHarbour].def.name}. They saved the boat, more or less. The cargo is gone, and ${lost} gold went to the shipwrights.`, button: 'Start again' });
  ui.fade(false); busy = false;
}
async function ending() {
  busy = true;
  audio.ignite(); ui.fade(true, true); await wait(1800);
  const s = game.s; boat.setUpgrades(s.upg, true); weather.setType('clear', true); boat.setSail(1);
  ui.story({ kicker: 'Horizon’s Edge', title: 'Beyond the Horizon', button: 'Sail on',
    text: `The Veil closes behind you like a door, gently.\n\nAhead there is no wall of cloud, no edge of the world — only more sea, wide and gold and unhurried, and beyond it, another horizon.\n\nIlse Maren was right. It was never a line.\n\n—\n\n${(s.stats.dist / 1852).toFixed(1)} sea-miles · ${s.day} days · ${Object.keys(s.discovered).length} islands charted\n\nYour sails have turned to gold. The whole sea is open to you now.` });
  game.save(boat, weather);
  await wait(400); ui.fade(false, true); busy = false;
  setTimeout(() => $('fade').classList.remove('white'), 1500);
}

// ---------- input ----------
function wireInput(canvas) {
  const press = (code) => {
    if (mode !== 'play') return;
    if (code === 'Escape') { if (ui.storyOpen) return; if (ui.panel) { if (ui.panel !== 'harbour') { ui.close(); audio.click(); } } else { ui.open('pause'); audio.click(); } return; }
    if (ui.storyOpen) { if (code === 'Enter' || code === 'Space') ui._closeStory(); return; }
    if (code === 'KeyM') { ui.panel === 'harbour' || ui.toggle('map'); return; }
    if (code === 'KeyJ') { ui.panel === 'harbour' || ui.toggle('journal'); return; }
    if (ui.blocking || busy) return;
    if (code === 'KeyE') { if (boat.sailLevel < 3) { boat.setSail(boat.sailLevel + 1); audio.rope(); } }
    else if (code === 'KeyQ') { if (boat.sailLevel > 0) { boat.setSail(boat.sailLevel - 1); audio.rope(); } }
    else if (code === 'KeyT') { boat.autoTrim = !boat.autoTrim; settings.autoTrim = boat.autoTrim; saveSettings(); ui.toast(boat.autoTrim ? 'Auto-trim on — the crew minds the sheet.' : 'Auto-trim off — the sheet is yours.'); audio.click(); }
    else if (code === 'Space') { boat.anchored = !boat.anchored; if (boat.anchored) boat.sailLevel = 0; audio.rope(); ui.toast(boat.anchored ? 'Anchor down, sails furled.' : 'Anchor aweigh.'); }
    else if (code === 'KeyF') doInteract();
    else if (code === 'KeyC') { cam.mode = (cam.mode + 1) % 2; cam.yaw = 0; cam.pitch = cam.mode ? 0.02 : 0.2; audio.click(); }
    else if (code === 'KeyH') { settings.keys = !settings.keys; saveSettings(); $('keys').classList.toggle('hidden', !settings.keys); }
    else if (code === 'KeyP') ui.open('pause');
  };
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    audio.init(); keys.add(e.code); press(e.code);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  // camera orbit
  let drag = null; const pts = new Map(); let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => { audio.init(); pts.set(e.pointerId, e); drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e);
    if (pts.size === 2) { const [a, b] = [...pts.values()], d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); if (pinch) cam.dist = clamp(cam.dist * pinch / d, 9, 70); pinch = d; return; }
    if (!drag || mode !== 'play') return;
    cam.yaw -= (e.clientX - drag.x) * 0.0055; cam.pitch = clamp(cam.pitch + (e.clientY - drag.y) * 0.004, cam.mode ? -0.6 : -0.02, cam.mode ? 0.7 : 1.25);
    drag.x = e.clientX; drag.y = e.clientY; cam.userT = 0;
  });
  const up = (e) => { pts.delete(e.pointerId); pinch = 0; if (!pts.size) drag = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.dist = clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 9, 70); }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  // touch buttons
  document.querySelectorAll('#touch button').forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); audio.init(); keys.add(k); press(k); });
    const off = () => keys.delete(k); b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') game.save(boat, weather); });
  addEventListener('beforeunload', () => { if (mode === 'play') game.save(boat, weather); });
}
function doInteract() {
  const it = interaction; if (!it || it.type === 'none') return;
  if (it.type === 'dock') dock(it.id);
  else if (it.type === 'beacon') { game.lightBeacon(it.id); cam.shake = 0.5; game.save(boat, weather); }
  else if (it.type === 'wreck') { game.lootWreck(it.id); game.save(boat, weather); }
}

// ---------- simulation ----------
function litColor(amb, light, bias) {
  const A = sky.shared.uAmbient.value, Lc = sky.shared.uLightColor.value;
  return col.setRGB(A.r * amb + Lc.r * light + bias, A.g * amb + Lc.g * light + bias, A.b * amb + Lc.b * light + bias);
}
const ctl = { steer: 0, sheet: 0 };
function step(dt) {
  const playing = mode === 'play', paused = playing && (ui.blocking || busy);
  const sdt = paused ? 0 : dt;
  simT += sdt;
  // time
  let hour;
  if (playing) {
    const s = game.s; s.hour += sdt * 24 / (settings.dayLen * 60);
    if (s.hour >= 24) { s.hour -= 24; s.day++; }
    hour = s.hour;
  } else { menuHour += dt * 0.004; if (menuHour > 17.9) menuHour = 17.2; hour = menuHour; }

  // weather with local overrides
  let override = null;
  if (playing) {
    if (game.edgeCalm > 0.01) override = { type: 'clear', k: game.edgeCalm };
    else if (game.veil > 0.01) override = { type: 'storm', k: game.veil, boost: 1.15 };
  }
  weather.update(sdt || (playing ? 0 : dt), camera, override);
  if (weather.flashRequest) { sky.flash = weather.flashRequest; weather.flashRequest = 0; }

  // boat
  if (!paused) {
    if (playing) {
      ctl.steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      ctl.sheet = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    } else { // menu: lazy circles off Port Haven
      const d = world.byId.haven.dock, tx = d.x + d.outX * 260, tz = d.z + d.outZ * 260;
      const away = Math.hypot(boat.pos.x - tx, boat.pos.z - tz);
      ctl.steer = away > 230 ? clamp(wrapAngle(Math.atan2(tx - boat.pos.x, -(tz - boat.pos.z)) - boat.heading) * 1.5, -0.6, 0.6) : 0.05; ctl.sheet = 0;
      boat.ext.set(0, 0, 0);
    }
    const ocdt = playing ? sdt : dt;
    ocean.update(ocdt, camera, { waveScale: weather.wave, chop: clamp(weather.wind.speed / 10, 0.3, 1.9), foam: smoothstep(5.5, 16, weather.wind.speed), rain: weather.rain });
    boat.update(ocdt, ctl, weather.wind, ocean, world);
    wake.fromBoat(boat, ocdt);
    if (Math.abs(boat.speed) > 5.5 && Math.random() < ocdt * (Math.abs(boat.speed) - 4.5) * 2.2) spray.burst(boat, 0.1 + weather.wave * 0.08, weather.wind);
    spray.update(ocdt, litColor(2.3, 0.6, 0.04));
    if (dolphins.update(ocdt, boat, ocean, spray, playing && sky.day > 0.5 && weather.storm < 0.3 && game.nearDist > 300, wake)) ui.toast('Dolphins off the bow!', 'good');
  }
  boat.setNight(sky.night);

  if (playing && !paused) {
    game.update(sdt, boat, weather);
    interaction = game.interaction(boat);
    // flotsam
    flotT -= sdt;
    if (flotT <= 0) {
      flotT = 1.5; nearFlotsam = [];
      const r2 = (game.sight * 0.8) ** 2;
      for (const def of game.flotsamDefs) {
        const a = game.flotsamActive(def); if (a !== def.obj.active) flotsam.setActive(def.obj, a);
        if (a && (def.x - boat.pos.x) ** 2 + (def.z - boat.pos.z) ** 2 < r2) nearFlotsam.push(def);
      }
    }
    const picked = flotsam.update(sdt, simT, boat, ocean, sky.night);
    if (picked) { flotsam.setActive(picked, false); const def = game.flotsamDefs.find((f) => f.id === picked.id); game.collect(def); audio.pickup(); audio.splash(0.6); spray.splash(picked.x, boat.y + 0.3, picked.z, 12, 0.8); flotT = 0; }
    // buoy bells
    bellT -= sdt;
    if (bellT <= 0) {
      bellT = 2.2 + Math.random() * 3 / (0.5 + weather.wave);
      let nd = 1e9; for (const b of world.buoys) nd = Math.min(nd, Math.hypot(b.x - boat.pos.x, b.z - boat.pos.z));
      if (nd < 260) audio.bell(640 + Math.random() * 20, 0.1 * (1 - nd / 260));
    }
  } else if (!playing) flotsam.update(dt, simT, boat, ocean, sky.night);

  updateCamera(dt, playing);
  sky.update(dt, hour, weather, boat.pos);
  sky.uniforms.uAurora.value = playing ? sky.night * (game.veilOpen ? 0.3 + 0.7 * game.edgeCalm : 0) : 0;
  scene.fog.color.copy(sky.fogColor); scene.fog.density = sky.shared.uFogDensity.value;
  ocean.uniforms.uWakeCenter.value.copy(wake.center);
  weather.rainMat.uniforms.uColor.value.copy(sky.shared.uAmbient.value).multiplyScalar(2.2).addScalar(0.1);
  world.update(dt, performance.now() / 1000, sky.night, camera.position, ocean, playing && game.veilOpen);
  birds.update(dt, performance.now() / 1000, boat, litColor(2.4, 0.7, 0), sky.fogColor, scene.fog.density, sky.day);
  wake.update(paused ? 0 : dt, renderer, boat.pos.x, boat.pos.z);

  audio.update(dt, {
    wind: weather.wind.speed, speed: paused ? 0 : boat.speed, rain: weather.rain, storm: weather.storm, luff: paused ? 0 : boat.luff * boat.hoist, night: sky.night, day: sky.day, wave: weather.wave,
    shore: playing ? smoothstep(380, 40, game.nearDist ?? 999) : 0.3, gulls: smoothstep(450, 80, birds.nearest), menu: !playing,
  });
  if (playing) ui.updateHUD(dt, { boat, wx: weather, hour, obj: game.objective(), interaction: paused ? null : interaction, flotsam: nearFlotsam });
}

function updateCamera(dt, playing) {
  cam.shake = Math.max(0, cam.shake - dt * 1.6);
  cam.head = dampAngle(cam.head, boat.heading, 2.2, dt);
  const sp = clamp(Math.abs(boat.speed) / 10, 0, 1);
  camera.fov = damp(camera.fov, (cam.mode === 1 ? 68 : 54) + sp * 7, 2, dt); camera.updateProjectionMatrix();
  if (!playing) cam.yaw += dt * 0.035;
  if (cam.mode === 1 && playing) {
    boat.mesh.updateMatrixWorld();
    camera.position.copy(v3.set(0.34, 2.55, 3.15).applyMatrix4(boat.mesh.matrixWorld));
    const yw = boat.heading + cam.yaw, cp = Math.cos(cam.pitch);
    v3b.set(Math.sin(yw) * cp, -Math.sin(cam.pitch) + 0.02, -Math.cos(yw) * cp);
    camera.up.set(0, 1, 0).applyAxisAngle(v3.set(boat.fwd.x, 0, boat.fwd.z), (boat.heel + boat.roll) * 0.5);
    camera.lookAt(v3.copy(camera.position).add(v3b));
    return;
  }
  camera.up.set(0, 1, 0);
  const yw = playing ? cam.head + Math.PI + cam.yaw : Math.PI / 2 - 0.2 + 0.3 * Math.sin(performance.now() * 0.00004), cp = Math.cos(cam.pitch);
  cam.target.set(boat.pos.x, damp(cam.target.y, boat.y * 0.6 + 3.2, 3, dt), boat.pos.z);
  const dist = cam.dist;
  camera.position.set(cam.target.x + Math.sin(yw) * cp * dist, cam.target.y + Math.sin(cam.pitch) * dist + 1.2, cam.target.z - Math.cos(yw) * cp * dist);
  const minY = Math.max(ocean.height(camera.position.x, camera.position.z) + 0.9, world.heightAt(camera.position.x, camera.position.z) + 1.6);
  if (camera.position.y < minY) camera.position.y = minY;
  v3.copy(cam.target);
  if (!playing) { // frame the boat to the right of the title
    const rx = Math.cos(yw), rz = Math.sin(yw);
    v3.x += rx * dist * 0.3 * (innerWidth > 820 ? 1 : 0); v3.z += rz * dist * 0.3 * (innerWidth > 820 ? 1 : 0); v3.y += 1.5;
  }
  if (cam.shake > 0) { v3.x += (Math.random() - 0.5) * cam.shake * 0.6; v3.y += (Math.random() - 0.5) * cam.shake * 0.6; }
  camera.lookAt(v3);
}

function render() {
  if (composer && settings.quality > 0) composer.render(); else renderer.render(scene, camera);
}

boot().catch((e) => { console.error(e); $('load-text').textContent = 'Something went wrong while loading: ' + e.message; });

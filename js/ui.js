// DOM interface: menus, HUD instruments, sea chart, harbour and journal screens
import { ISLANDS, HARBOURS, BEACONS, GOODS, UPGRADES, BOTTLES, WORLD_SIZE, HEIGHTMAP_RES, VEIL_RADIUS, PRICE_MULT } from './config.js';
import { WEATHER } from './weather.js';
import { SAIL_NAMES } from './boat.js';
import { FOG_N } from './game.js';
import { TAU, DEG, KNOTS, clamp, lerp, wrapAngle, compassName, fmtTime, bearingTo, hash2 } from './util.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const DISPLAY = "'Cinzel', Georgia, serif", BODY = "'Cormorant', Georgia, serif";
const MAP_SPAN = 11900, MAP_CX = 0, MAP_CZ = -450;

export class UI {
  constructor(game, world, audio, settings, hooks) {
    this.game = game; this.world = world; this.audio = audio; this.settings = settings; this.hooks = hooks;
    this.panel = null; this.storyQ = []; this.storyOpen = false; this.storyCb = null;
    this.hbTab = 'master'; this.jTab = 'voyage'; this.harbourId = null; this.tavernText = '';
    this._t = 0; this._slow = 0; this._mini = 0; this.hudT = 0;
    this._buildMapBase();
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = this.fogCanvas.height = FOG_N;
    this._wire();
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) $('touch').dataset.enabled = '1';
  }

  // ---------- wiring ----------
  _wire() {
    const A = this.audio, click = (id, fn) => $(id).addEventListener('click', () => { A.init(); A.click(); fn(); });
    document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseenter', () => A.hover()));
    click('btn-new', () => this.hooks.newGame());
    click('btn-continue', () => this.hooks.continueGame());
    click('btn-howto', () => this.open('help'));
    click('btn-settings', () => this.open('settings'));
    click('btn-credits', () => this.open('credits'));
    click('ps-resume', () => this.close());
    click('ps-howto', () => this.open('help', 'pause'));
    click('ps-settings', () => this.open('settings', 'pause'));
    click('ps-quit', () => { this.close(); this.hooks.quit(); });
    click('hb-leave', () => this.hooks.castOff());
    click('story-btn', () => this._closeStory());
    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => { A.click(); this.close(); }));
    document.querySelectorAll('.overlay').forEach((o) => o.addEventListener('pointerdown', (e) => { if (e.target === o && o.id !== 'story' && o.id !== 'panel-harbour') this.close(); }));
    $('hb-tabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (t) { A.click(); this.hbTab = t; this._renderHarbour(); } });
    $('journal-tabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (t) { A.click(); this.jTab = t; this._renderJournal(); } });
    $('hb-body').addEventListener('click', (e) => this._harbourAction(e));
    // settings
    const S = this.settings, bind = (id, key, conv, ev = 'input') => { const n = $(id); n.addEventListener(ev, () => { S[key] = conv(n); this.hooks.setting(key, S[key]); }); };
    bind('set-quality', 'quality', (n) => +n.value, 'change'); bind('set-master', 'master', (n) => n.value / 100); bind('set-music', 'music', (n) => n.value / 100);
    bind('set-sfx', 'sfx', (n) => n.value / 100); bind('set-autotrim', 'autoTrim', (n) => n.checked, 'change'); bind('set-keys', 'keys', (n) => n.checked, 'change');
    bind('set-day', 'dayLen', (n) => +n.value, 'change');
    let armed = false;
    $('set-wipe').addEventListener('click', () => {
      if (!armed) { armed = true; $('set-wipe').textContent = 'Click again to erase forever'; setTimeout(() => { armed = false; $('set-wipe').textContent = 'Erase saved voyage'; }, 3500); return; }
      this.hooks.wipe(); $('set-wipe').textContent = 'Saved voyage erased'; armed = false;
    });
    this.syncSettings();
  }
  syncSettings() {
    const S = this.settings;
    $('set-quality').value = S.quality; $('set-master').value = S.master * 100; $('set-music').value = S.music * 100; $('set-sfx').value = S.sfx * 100;
    $('set-autotrim').checked = S.autoTrim; $('set-keys').checked = S.keys; $('set-day').value = S.dayLen;
    $('keys').classList.toggle('hidden', !S.keys);
  }

  // ---------- screens ----------
  loading(p, text) { $('load-fill').style.width = Math.round(p * 100) + '%'; if (text) $('load-text').textContent = text; }
  loaded() { $('loading').classList.add('out'); setTimeout(() => $('loading').classList.add('hidden'), 1400); }
  showMenu(hasSave, info) {
    $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('touch').classList.add('hidden');
    $('btn-continue').classList.toggle('hidden', !hasSave); $('continue-info').textContent = info || '';
  }
  showGame() {
    $('menu').classList.add('hidden'); $('hud').classList.remove('hidden');
    if ($('touch').dataset.enabled) $('touch').classList.remove('hidden');
  }
  fade(on, white) { const f = $('fade'); f.classList.toggle('white', !!white); f.classList.toggle('on', on); }
  get blocking() { return !!this.panel || this.storyOpen; }

  open(name, back) {
    if (this.panel) $('panel-' + this.panel).classList.add('hidden');
    this.panel = name; this.back = back || null;
    $('panel-' + name).classList.remove('hidden');
    if (name === 'map') this._renderMap();
    if (name === 'journal') this._renderJournal();
    if (name === 'settings') this.syncSettings();
  }
  close() {
    if (!this.panel) return;
    if (this.panel === 'harbour') return; // leave via cast off
    $('panel-' + this.panel).classList.add('hidden');
    const back = this.back; this.panel = null; this.back = null;
    if (back) this.open(back);
  }
  toggle(name) { if (this.panel === name) this.close(); else if (!this.panel && !this.storyOpen) this.open(name); }

  toast(text, kind = '') {
    const t = el('div', 'toast ' + kind, text); $('toasts').appendChild(t);
    while ($('toasts').children.length > 4) $('toasts').firstChild.remove();
    setTimeout(() => t.remove(), 6000);
  }
  banner(title, sub, kicker = 'Discovered') {
    const b = $('banner'); b.classList.add('hidden'); void b.offsetWidth;
    $('banner-title').textContent = title; $('banner-sub').textContent = sub || ''; $('banner-kicker').textContent = kicker;
    b.classList.remove('hidden'); clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.add('hidden'), 6500);
  }
  story(s) { this.storyQ.push({ ...s, wait: s.delay || 0 }); }
  _closeStory() {
    $('story').classList.add('hidden'); this.storyOpen = false;
    const cb = this.storyCb; this.storyCb = null; if (cb) cb();
  }
  tick(dt) { // real-time, even when paused
    if (!this.storyOpen && this.storyQ.length && (!this.panel || this.panel === 'harbour')) {
      const s = this.storyQ[0]; s.wait -= dt;
      if (s.wait <= 0) {
        this.storyQ.shift(); this.storyOpen = true; this.storyCb = s.onClose || null;
        $('story-kicker').textContent = s.kicker || ''; $('story-title').textContent = s.title; $('story-text').textContent = s.text; $('story-btn').textContent = s.button || 'Continue';
        $('story').classList.remove('hidden');
      }
    }
  }

  // ---------- HUD ----------
  updateHUD(dt, d) {
    this._t += dt; this.hudT += dt;
    if (this.hudT < 0.05) return; this.hudT = 0;
    const { boat, wx, hour, obj } = d, s = this.game.s;
    this._drawCompass(boat, wx, obj);
    this._drawDial(boat, wx);
    $('h-speed').textContent = (Math.abs(boat.speed) * KNOTS).toFixed(1);
    this._slow -= 0.05;
    if (this._slow <= 0) {
      this._slow = 0.25;
      const hd = ((boat.heading / DEG) % 360 + 360) % 360;
      $('heading').textContent = `${compassName(hd)}  ${String(Math.round(hd) % 360).padStart(3, '0')}°`;
      $('st-time').textContent = fmtTime(hour); $('st-day').textContent = 'Day ' + s.day;
      const W = WEATHER[wx.type]; $('st-wx').textContent = this.game.veil > 0.5 ? 'The Veil' : W.label; $('st-wx-icon').textContent = this.game.veil > 0.5 ? '⛈' : W.icon;
      $('st-gold').textContent = s.gold; $('st-rank').textContent = this.game.rank().name;
      const wd = ((wx.wind.dir / DEG) % 360 + 360) % 360;
      $('h-wind').textContent = `${Math.round(wx.wind.speed * KNOTS)} kn from ${compassName(wd)}`;
      $('h-sail').textContent = SAIL_NAMES[boat.sailLevel];
      [...$('h-pips').children].forEach((p, i) => p.classList.toggle('on', i < boat.sailLevel));
      $('h-sheet').style.width = Math.round(boat.sheet * 100) + '%';
      const eff = boat.hoist > 0.05 ? boat.eff : 0;
      $('h-trim').style.width = Math.round(eff * 100) + '%';
      $('h-trim').style.background = eff > 0.85 ? '#7cc27a' : eff > 0.55 ? '#d9b36c' : '#d0553f';
      $('h-trimv').textContent = boat.hoist > 0.05 ? Math.round(eff * 100) + '%' : '—';
      const hp = clamp(s.hull / this.game.hullMax, 0, 1);
      $('h-hull').style.width = Math.round(hp * 100) + '%'; $('h-hull').style.background = hp > 0.5 ? '#7cc27a' : hp > 0.25 ? '#d9b36c' : '#d0553f';
      $('h-hullv').textContent = Math.max(0, Math.round(s.hull));
      $('tag-auto').classList.toggle('on', boat.autoTrim); $('tag-anchor').classList.toggle('on', boat.anchored);
      $('obj-title').textContent = obj.title; $('obj-text').textContent = obj.text;
      if (obj.target) {
        const dist = Math.hypot(obj.target.x - boat.pos.x, obj.target.z - boat.pos.z);
        const b = ((bearingTo(boat.pos.x, boat.pos.z, obj.target.x, obj.target.z) / DEG) + 360) % 360;
        $('obj-dist').textContent = `${dist > 1852 ? (dist / 1852).toFixed(1) + ' nm' : Math.round(dist / 10) * 10 + ' m'}  ·  bearing ${compassName(b)} ${String(Math.round(b)).padStart(3, '0')}°`;
      } else $('obj-dist').textContent = '';
      // prompt + warnings
      const it = d.interaction;
      $('prompt').classList.toggle('hidden', !it);
      if (it) { $('prompt-text').textContent = it.label; $('prompt').querySelector('kbd').style.display = it.type === 'none' ? 'none' : ''; }
      let warn = '';
      if (boat.aground) warn = 'Aground — steer for deeper water';
      else if (boat.overpowered > 0.4) warn = 'Overpowered — reef (Q) or ease the sheet (W)';
      else if (hp < 0.28) warn = 'Hull failing — make for a harbour';
      else if (boat.inIrons && Math.abs(boat.speed) < 2) warn = 'In irons — bear away from the wind';
      else if (boat.luff > 0.7 && !boat.inIrons && boat.hoist > 0.3) warn = 'Sails luffing — haul in the sheet (S)';
      else if (boat.anchored && boat.sailLevel === 0 && s.quest > 0 && d.idle > 14) warn = '';
      $('warn').textContent = warn || $('warn').textContent; $('warn').classList.toggle('on', !!warn);
    }
    this._mini -= 0.05;
    if (this._mini <= 0) { this._mini = 0.12; this._drawMini(boat, obj, d.flotsam); }
  }

  _drawCompass(boat, wx, obj) {
    const c = $('compass'), g = c.getContext('2d'), W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const hd = boat.heading / DEG, ppd = 5.2, cx = W / 2;
    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(8,20,34,0)'); grad.addColorStop(0.2, 'rgba(8,20,34,0.6)'); grad.addColorStop(0.8, 'rgba(8,20,34,0.6)'); grad.addColorStop(1, 'rgba(8,20,34,0)');
    g.fillStyle = grad; g.fillRect(0, 18, W, 56);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fadeAt = (x) => clamp(1 - Math.abs(x - cx) / (W / 2 - 30), 0, 1);
    for (let a = Math.floor((hd - 100) / 5) * 5; a <= hd + 100; a += 5) {
      const x = cx + (a - hd) * ppd, k = fadeAt(x); if (k <= 0) continue;
      const n = ((a % 360) + 360) % 360;
      g.globalAlpha = k;
      if (n % 45 === 0) {
        const card = n % 90 === 0;
        g.fillStyle = n === 0 ? '#f3d9a1' : '#e9e4d6'; g.font = `600 ${card ? 30 : 20}px ${DISPLAY}`;
        g.fillText(compassName(n), x, 44);
        g.fillStyle = '#d9b36c'; g.fillRect(x - 1, 64, 2, 10);
      } else { g.fillStyle = 'rgba(233,228,214,0.55)'; g.fillRect(x - 1, n % 15 === 0 ? 34 : 40, 2, n % 15 === 0 ? 20 : 8); }
    }
    g.globalAlpha = 1;
    const mark = (bear, color, shape) => {
      let da = wrapAngle(bear - boat.heading) / DEG; const off = Math.abs(da) > 96; da = clamp(da, -96, 96);
      const x = cx + da * ppd; g.fillStyle = color; g.strokeStyle = '#081422'; g.lineWidth = 2; g.beginPath();
      if (shape === 'goal') { g.moveTo(x, 4); g.lineTo(x + 11, 15); g.lineTo(x, 26); g.lineTo(x - 11, 15); }
      else { g.moveTo(x - 9, 78); g.lineTo(x + 9, 78); g.lineTo(x, 94); }
      g.closePath(); g.globalAlpha = off ? 0.55 : 1; g.fill(); g.stroke(); g.globalAlpha = 1;
    };
    mark(wx.wind.dir, '#8fd0e6', 'wind');
    if (obj.target) mark(bearingTo(boat.pos.x, boat.pos.z, obj.target.x, obj.target.z), '#f0c060', 'goal');
    g.fillStyle = '#f3d9a1'; g.beginPath(); g.moveTo(cx - 8, 16); g.lineTo(cx + 8, 16); g.lineTo(cx, 28); g.closePath(); g.fill();
  }

  _drawDial(boat, wx) {
    const c = $('winddial'), g = c.getContext('2d'), S = c.width, R = S / 2 - 14, cx = S / 2, cy = S / 2;
    g.clearRect(0, 0, S, S); g.save(); g.translate(cx, cy);
    // rim
    g.strokeStyle = 'rgba(217,179,108,0.55)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(233,228,214,0.35)';
    for (let a = 0; a < 360; a += 15) { const r0 = a % 45 === 0 ? R - 14 : R - 7; g.save(); g.rotate(a * DEG); g.beginPath(); g.moveTo(0, -R); g.lineTo(0, -r0); g.stroke(); g.restore(); }
    // no-go zone around the true wind
    const twa = boat.twa;
    g.save(); g.rotate(twa); g.fillStyle = 'rgba(208,85,63,0.3)'; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R - 2, -Math.PI / 2 - 0.66, -Math.PI / 2 + 0.66); g.closePath(); g.fill(); g.restore();
    // hull
    g.fillStyle = 'rgba(233,228,214,0.16)'; g.strokeStyle = 'rgba(233,228,214,0.8)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(0, -78); g.bezierCurveTo(30, -40, 30, 30, 20, 70); g.lineTo(-20, 70); g.bezierCurveTo(-30, 30, -30, -40, 0, -78); g.fill(); g.stroke();
    // ideal boom
    const A = Math.abs(boat.awa), side = boat.awa >= 0 ? 1 : -1;
    if (boat.hoist > 0.05 && !boat.autoTrim) {
      const ideal = clamp(A - 0.4, 7 * DEG, 86 * DEG);
      g.save(); g.translate(0, -18); g.rotate(side * ideal); g.setLineDash([6, 7]); g.strokeStyle = 'rgba(124,194,122,0.85)'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 86); g.stroke(); g.restore();
    }
    // sail
    if (boat.hoist > 0.05) {
      const eff = boat.eff, col = eff > 0.85 ? '#8fd68c' : eff > 0.55 ? '#e8c57c' : '#e4735c';
      g.save(); g.translate(0, -18); g.rotate(-boat.boom); g.strokeStyle = col; g.lineWidth = 6; g.lineCap = 'round';
      const belly = clamp(boat.fill, -1, 1) * 22 * (boat.boom > 0 ? 1 : 1);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(belly, 42, 0, 84 * (0.45 + 0.55 * boat.hoist)); g.stroke(); g.restore();
    } else { g.strokeStyle = 'rgba(233,228,214,0.4)'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, -18); g.lineTo(0, 62); g.stroke(); }
    g.fillStyle = '#e9e4d6'; g.beginPath(); g.arc(0, -18, 5, 0, TAU); g.fill();
    // apparent wind arrow
    g.save(); g.rotate(boat.awa); g.fillStyle = '#8fd0e6'; g.strokeStyle = '#081422'; g.lineWidth = 2;
    const len = 26 + clamp(boat.aws / 20, 0, 1) * 30;
    g.beginPath(); g.moveTo(0, -R + len + 16); g.lineTo(13, -R + 2 + 14); g.lineTo(4, -R + 2 + 14); g.lineTo(4, -R - 6); g.lineTo(-4, -R - 6); g.lineTo(-4, -R + 16); g.lineTo(-13, -R + 16); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.restore();
    g.fillStyle = 'rgba(169,180,189,0.9)'; g.font = `600 17px ${DISPLAY}`; g.textAlign = 'center';
    g.fillText(`${Math.round(Math.abs(boat.awa) / DEG)}° ${boat.awa >= 0 ? 'STBD' : 'PORT'}`, cx, S - 22);
  }

  // ---------- chart ----------
  _buildMapBase() {
    const N = 1024, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), d = img.data, H = this.world.heightData, R = HEIGHTMAP_RES, st = R / N;
    const hAt = (i, j) => H[Math.min(R - 1, Math.max(0, Math.round(j * st))) * R + Math.min(R - 1, Math.max(0, Math.round(i * st)))];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h = hAt(i, j), o = (j * N + i) * 4, grain = (hash2(i, j) - 0.5) * 10;
      let r, gg, b;
      if (h <= 0) {
        const t = clamp(-h / 14, 0, 1);
        r = lerp(150, 216, t); gg = lerp(196, 204, t); b = lerp(190, 166, t);
        if (h > -1.2) { r = 238; gg = 226; b = 190; }
      } else {
        const sh = clamp((hAt(i - 1, j - 1) - hAt(i + 1, j + 1)) * 0.06, -0.35, 0.35), t = clamp(h / 120, 0, 1);
        r = lerp(205, 150, t) * (1 + sh); gg = lerp(182, 122, t) * (1 + sh); b = lerp(128, 80, t) * (1 + sh);
        if (hAt(i - 1, j) <= 0 || hAt(i + 1, j) <= 0 || hAt(i, j - 1) <= 0 || hAt(i, j + 1) <= 0) { r = 74; gg = 56; b = 36; }
      }
      d[o] = r + grain; d[o + 1] = gg + grain; d[o + 2] = b + grain; d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c;
  }
  _refreshFog() {
    const g = this.fogCanvas.getContext('2d'), img = g.createImageData(FOG_N, FOG_N), f = this.game.fog;
    for (let i = 0; i < f.length; i++) { const o = i * 4, v = (hash2(i, 7) - 0.5) * 14; img.data[o] = 196 + v; img.data[o + 1] = 180 + v; img.data[o + 2] = 138 + v; img.data[o + 3] = f[i] ? 0 : 255; }
    g.putImageData(img, 0, 0); this.game.fogDirty = false;
  }
  _drawChart(g, size, cx, cz, span, full, boat, obj, flotsam) {
    if (this.game.fogDirty) this._refreshFog();
    const s = this.game.s, W = this.world, N = this.mapBase.width;
    const px = (x) => (x - cx) / span * size + size / 2, pz = (z) => (z - cz) / span * size + size / 2;
    const sx = ((cx - span / 2) / WORLD_SIZE + 0.5) * N, sz = ((cz - span / 2) / WORLD_SIZE + 0.5) * N, sw = span / WORLD_SIZE * N;
    g.fillStyle = '#c4b48a'; g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(this.mapBase, sx, sz, sw, sw, 0, 0, size, size);
    const fs = FOG_N / N;
    g.drawImage(this.fogCanvas, sx * fs, sz * fs, sw * fs, sw * fs, 0, 0, size, size);
    const k = size / (full ? 1200 : 360);
    if (full) { // graticule + veil
      g.strokeStyle = 'rgba(90,70,48,0.16)'; g.lineWidth = 1;
      for (let v = -6000; v <= 6000; v += 1000) { g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), size); g.moveTo(0, pz(v)); g.lineTo(size, pz(v)); g.stroke(); }
      g.strokeStyle = 'rgba(122,42,30,0.6)'; g.lineWidth = 2; g.setLineDash([10, 9]); g.beginPath();
      const r = VEIL_RADIUS / span * size;
      if (this.game.veilOpen) g.arc(px(0), pz(0), r, -Math.PI / 2 + 0.36, Math.PI * 1.5 - 0.36); else g.arc(px(0), pz(0), r, 0, TAU);
      g.stroke(); g.setLineDash([]);
      g.fillStyle = 'rgba(122,42,30,0.75)'; g.font = `italic 500 ${20 * k}px ${BODY}`; g.textAlign = 'center';
      g.fillText('~ the Veil ~', px(0), pz(VEIL_RADIUS) + 26 * k);
    }
    // islands
    for (const isl of W.islands) {
      const I = isl.def, X = px(I.x), Z = pz(I.z);
      if (X < -60 || Z < -60 || X > size + 60 || Z > size + 60) continue;
      const known = s.discovered[I.id];
      if (!known && !s.charted[I.id]) continue;
      if (!known) {
        g.strokeStyle = 'rgba(74,56,36,0.75)'; g.lineWidth = 1.6 * k; g.setLineDash([5 * k, 5 * k]); g.beginPath(); g.arc(X, Z, I.r / span * size * 0.8 + 4, 0, TAU); g.stroke(); g.setLineDash([]);
        g.fillStyle = 'rgba(74,56,36,0.85)'; g.font = `italic 500 ${(full ? 23 : 30) * k}px ${BODY}`; g.textAlign = 'center'; g.fillText(full ? I.name + ' ?' : '?', X, Z + (full ? I.r / span * size + 20 * k : 9 * k));
        continue;
      }
      const icon = (x, z, kind, on) => {
        const X2 = px(x), Z2 = pz(z), r = (full ? 7 : 12) * k; g.lineWidth = 2 * k;
        if (kind === 'dock') { g.fillStyle = '#2c5a7a'; g.strokeStyle = '#f1e3bd'; g.beginPath(); g.arc(X2, Z2, r, 0, TAU); g.fill(); g.stroke(); }
        if (kind === 'light') { g.fillStyle = '#f6e9a8'; g.strokeStyle = '#7a5a22'; g.fillRect(X2 - r * 0.8, Z2 - r * 0.8, r * 1.6, r * 1.6); g.strokeRect(X2 - r * 0.8, Z2 - r * 0.8, r * 1.6, r * 1.6); }
        if (kind === 'beacon') { g.fillStyle = on ? '#f0b040' : '#8a8478'; g.strokeStyle = '#4a3410'; g.beginPath(); g.moveTo(X2, Z2 - r * 1.3); g.lineTo(X2 + r, Z2); g.lineTo(X2, Z2 + r * 1.3); g.lineTo(X2 - r, Z2); g.closePath(); g.fill(); g.stroke();
          if (on) { g.strokeStyle = 'rgba(240,176,64,0.5)'; g.beginPath(); g.arc(X2, Z2, r * 2.2, 0, TAU); g.stroke(); } }
        if (kind === 'wreck') { g.strokeStyle = on ? 'rgba(107,42,30,0.4)' : '#6b2a1e'; g.lineWidth = 3 * k; g.beginPath(); g.moveTo(X2 - r, Z2 - r); g.lineTo(X2 + r, Z2 + r); g.moveTo(X2 + r, Z2 - r); g.lineTo(X2 - r, Z2 + r); g.stroke(); }
      };
      if (isl.dock) icon(isl.dock.berthX, isl.dock.berthZ, 'dock');
      if (isl.light) icon(isl.light.x, isl.light.z, 'light');
      if (isl.beacon) icon(isl.beacon.x, isl.beacon.z, 'beacon', s.beacons[I.id]);
      if (isl.wreck) icon(isl.wreck.x, isl.wreck.z, 'wreck', s.wrecks[I.id]);
      if (isl.gate) icon(isl.gate.x, isl.gate.z, 'beacon', true);
      if (full) {
        g.font = `600 ${21 * k}px ${DISPLAY}`; g.textAlign = 'center';
        const ty = Z + I.r / span * size + 26 * k;
        g.strokeStyle = 'rgba(232,220,180,0.85)'; g.lineWidth = 4 * k; g.strokeText(I.name.toUpperCase(), X, ty);
        g.fillStyle = '#3a2a18'; g.fillText(I.name.toUpperCase(), X, ty);
      }
    }
    if (flotsam) { g.fillStyle = '#fff6c8'; g.strokeStyle = '#6a4a16'; g.lineWidth = 1.5; for (const f of flotsam) { g.beginPath(); g.arc(px(f.x), pz(f.z), 4.5 * k, 0, TAU); g.fill(); g.stroke(); } }
    if (obj && obj.target) {
      let X = px(obj.target.x), Z = pz(obj.target.z);
      if (!full) { const dx = X - size / 2, dz = Z - size / 2, dl = Math.hypot(dx, dz), m = size / 2 - 16; if (dl > m) { X = size / 2 + dx / dl * m; Z = size / 2 + dz / dl * m; } }
      const pulse = 1 + 0.25 * Math.sin(this._t * 4);
      g.strokeStyle = '#b8791a'; g.lineWidth = 3 * k; g.beginPath(); g.arc(X, Z, (full ? 15 : 13) * k * pulse, 0, TAU); g.stroke();
      g.strokeStyle = '#ffe9a8'; g.lineWidth = 1.5 * k; g.beginPath(); g.arc(X, Z, (full ? 15 : 13) * k * pulse, 0, TAU); g.stroke();
    }
    if (boat) {
      g.save(); g.translate(px(boat.pos.x), pz(boat.pos.z)); g.rotate(boat.heading);
      const r = (full ? 13 : 15) * k; g.fillStyle = '#c8402c'; g.strokeStyle = '#fff3d6'; g.lineWidth = 2 * k;
      g.beginPath(); g.moveTo(0, -r * 1.3); g.lineTo(r * 0.8, r); g.lineTo(0, r * 0.45); g.lineTo(-r * 0.8, r); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
  }
  _drawMini(boat, obj, flotsam) {
    const c = $('minimap'), g = c.getContext('2d'), S = c.width;
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, TAU); g.clip();
    this._drawChart(g, S, boat.pos.x, boat.pos.z, 2000, false, boat, obj, flotsam);
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2); gr.addColorStop(0, 'rgba(8,20,34,0)'); gr.addColorStop(1, 'rgba(8,20,34,0.4)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S); g.restore();
  }
  _renderMap() {
    const c = $('mapcanvas'), g = c.getContext('2d'), S = c.width, boat = this.hooks.boat(), obj = this.game.objective();
    this._drawChart(g, S, MAP_CX, MAP_CZ, MAP_SPAN, true, boat, obj);
    // compass rose
    g.save(); g.translate(S - 110, S - 110); g.strokeStyle = 'rgba(74,56,36,0.7)'; g.fillStyle = 'rgba(74,56,36,0.7)'; g.lineWidth = 1.5;
    for (let i = 0; i < 8; i++) { g.save(); g.rotate(i * Math.PI / 4); const L = i % 2 ? 34 : 60; g.beginPath(); g.moveTo(0, -L); g.lineTo(7, 0); g.lineTo(-7, 0); g.closePath(); i % 2 ? g.stroke() : g.fill(); g.restore(); }
    g.beginPath(); g.arc(0, 0, 44, 0, TAU); g.stroke(); g.font = `600 22px ${DISPLAY}`; g.textAlign = 'center'; g.fillText('N', 0, -68); g.restore();
    // scale bar: 1 nautical mile
    const nm = 1852 / MAP_SPAN * S; g.fillStyle = '#3a2a18'; g.fillRect(40, S - 46, nm, 4); g.fillRect(40, S - 54, 2, 12); g.fillRect(40 + nm - 2, S - 54, 2, 12);
    g.font = `italic 500 20px ${BODY}`; g.textAlign = 'left'; g.fillText('1 sea-mile', 40, S - 62);
    const s = this.game.s, found = ISLANDS.filter((I) => s.discovered[I.id]).length;
    const fogN = this.game.fog.reduce((a, b) => a + b, 0);
    $('map-meta').textContent = `Day ${s.day} · ${Math.round(fogN / this.game.fog.length * 100)}% of the sea explored`;
    $('map-progress').innerHTML = `Islands charted: <b>${found} / ${ISLANDS.length}</b><br>Beacons lit: <b>${this.game.beaconCount} / 5</b><br>Wrecks searched: <b>${Object.keys(s.wrecks).length} / 4</b><br>Bottles found: <b>${s.bottles.length} / ${BOTTLES.length}</b>`;
  }

  // ---------- journal ----------
  _renderJournal() {
    const s = this.game.s, body = $('journal-body'), G = this.game;
    [...$('journal-tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.tab === this.jTab));
    if (this.jTab === 'voyage') {
      const r = G.rank(), o = G.objective(), hrs = s.stats.time / 3600;
      body.innerHTML = `<h3>Standing</h3><div class="entry"><h4>${r.name}<small>${s.renown} renown${r.next ? ` · ${r.next.at - s.renown} to ${r.next.name}` : ''}</small></h4></div>
        <h3>Current course</h3><div class="entry"><h4>${o.title}</h4><p>${o.text}</p></div>
        <h3>Log</h3><div class="stats">
        <div class="stat"><b>${(s.stats.dist / 1852).toFixed(1)}</b><span>Sea-miles sailed</span></div>
        <div class="stat"><b>${hrs < 1 ? Math.round(hrs * 60) + ' min' : hrs.toFixed(1) + ' h'}</b><span>Time at sea</span></div>
        <div class="stat"><b>${s.stats.maxKn.toFixed(1)} kn</b><span>Top speed</span></div>
        <div class="stat"><b>${s.day}</b><span>Days</span></div>
        <div class="stat"><b>${ISLANDS.filter((I) => s.discovered[I.id]).length} / ${ISLANDS.length}</b><span>Islands charted</span></div>
        <div class="stat"><b>${G.beaconCount} / 5</b><span>Beacons lit</span></div>
        <div class="stat"><b>${s.stats.deliveries}</b><span>Contracts delivered</span></div>
        <div class="stat"><b>${Math.round(s.stats.profit)}</b><span>Trading balance</span></div></div>`;
    } else if (this.jTab === 'islands') {
      body.innerHTML = ISLANDS.map((I) => {
        const isl = this.world.byId[I.id];
        if (!s.discovered[I.id]) return `<div class="entry unknown"><h4>${s.charted[I.id] ? I.name + '<small>rumoured</small>' : 'Uncharted waters'}</h4></div>`;
        const tags = [isl.dock && 'harbour', isl.light && 'lighthouse', isl.beacon && (s.beacons[I.id] ? 'beacon lit' : 'beacon dark'), isl.wreck && (s.wrecks[I.id] ? 'wreck searched' : 'wreck'), isl.gate && 'the gate'].filter(Boolean).join(' · ');
        return `<div class="entry"><h4>${I.name}<small>${tags}</small></h4><p>${I.blurb}</p></div>`;
      }).join('');
    } else if (this.jTab === 'bottles') {
      body.innerHTML = s.bottles.length ? [...s.bottles].sort((a, b) => a - b).map((n) => `<div class="entry"><h4>${BOTTLES[n].title}</h4><p class="bottle-text">${BOTTLES[n].text}</p></div>`).join('') + `<p class="note">${s.bottles.length} of ${BOTTLES.length} found.</p>`
        : '<p class="note">No bottles yet. Watch for a green glimmer on the water — sail over it to haul it aboard.</p>';
    } else {
      const cargo = Object.keys(s.cargo);
      body.innerHTML = `<h3>Hold — ${G.holdUsed()} / ${G.holdCap} crates</h3>` + (cargo.length ? cargo.map((k) => `<div class="entry"><h4>${GOODS.find((g) => g.id === k).name}<small>${s.cargo[k]} crates</small></h4></div>`).join('') : '<p class="note">The hold is empty.</p>')
        + '<h3>Contracts</h3>' + (s.contracts.length ? s.contracts.map((c) => `<div class="entry"><h4>${c.crates} × ${c.label}<small>${c.reward} gold</small></h4><p>Deliver to ${this.world.byId[c.to].def.name}.</p></div>`).join('') : '<p class="note">No contracts aboard. Harbourmasters always have work.</p>')
        + '<h3>Fittings</h3>' + UPGRADES.map((u) => `<div class="entry"><h4>${u.name}<small>${u.levels[s.upg[u.id]]}</small></h4></div>`).join('');
    }
  }

  // ---------- harbour ----------
  openHarbour(id) {
    this.harbourId = id; this.hbTab = 'master'; this.tavernText = ''; $('hb-msg').textContent = '';
    $('hb-name').textContent = this.world.byId[id].def.name;
    this.open('harbour'); this._renderHarbour();
  }
  closeHarbour() { $('panel-harbour').classList.add('hidden'); this.panel = null; this.harbourId = null; }
  _renderHarbour() {
    const G = this.game, s = G.s, h = this.harbourId, body = $('hb-body');
    [...$('hb-tabs').children].forEach((b) => b.classList.toggle('on', b.dataset.tab === this.hbTab));
    $('hb-gold').textContent = s.gold; $('hb-hold').textContent = `Hold ${G.holdUsed()} / ${G.holdCap}`;
    if (this.hbTab === 'master') {
      const o = G.offers(h), I = this.world.byId[h].def;
      const mine = s.contracts.map((c) => `<div class="entry"><h4>${c.crates} × ${c.label}<small>${c.reward} gold on delivery</small></h4><p>Bound for ${this.world.byId[c.to].def.name}.</p></div>`).join('');
      body.innerHTML = `<p class="note">${I.blurb}</p><h3>Work on offer</h3><div class="cards">` + o.list.map((c) => {
        const T = this.world.byId[c.to].def, taken = o.taken.includes(c.id), dist = (Math.hypot(T.x - I.x, T.z - I.z) / 1852).toFixed(1);
        const b = (bearingTo(I.x, I.z, T.x, T.z) / DEG + 360) % 360;
        return `<div class="cardlet"><h4>Deliver ${c.label}</h4><p>${c.crates} crate${c.crates > 1 ? 's' : ''} to <b>${T.name}</b> — ${dist} sea-miles ${compassName(b)}.</p><div class="foot"><span>${c.reward} gold</span><button class="pbtn sm" data-act="accept" data-id="${c.id}" ${taken ? 'disabled' : ''}>${taken ? 'Aboard' : 'Accept'}</button></div></div>`;
      }).join('') + `</div><h3>Contracts aboard (${s.contracts.length}/3)</h3>${mine || '<p class="note">None yet.</p>'}`;
    } else if (this.hbTab === 'market') {
      body.innerHTML = `<table class="trade"><tr><th>Goods</th><th class="num">In hold</th><th class="num">Buy</th><th class="num">Sell</th><th></th><th></th></tr>` + GOODS.map((g) => {
        const m = PRICE_MULT[h][g.id], cls = m < 0.85 ? 'cheap' : m > 1.15 ? 'dear' : '', have = s.cargo[g.id] || 0;
        return `<tr><td>${g.name} ${m < 0.85 ? '<small class="note">— made here</small>' : m > 1.15 ? '<small class="note">— in demand</small>' : ''}</td><td class="num">${have}</td><td class="num ${cls}">${G.price(h, g.id)}</td><td class="num ${cls}">${G.price(h, g.id, true)}</td>
          <td class="num"><button class="pbtn sm" data-act="buy" data-id="${g.id}" data-n="1">Buy</button> <button class="pbtn sm ghost" data-act="buy" data-id="${g.id}" data-n="5">×5</button></td>
          <td class="num"><button class="pbtn sm" data-act="sell" data-id="${g.id}" data-n="1" ${have ? '' : 'disabled'}>Sell</button> <button class="pbtn sm ghost" data-act="sell" data-id="${g.id}" data-n="99" ${have ? '' : 'disabled'}>All</button></td></tr>`;
      }).join('') + '</table><p class="note">Green prices are a bargain; red are dear. Buy where goods are made, sell where they are wanted.</p>';
    } else if (this.hbTab === 'yard') {
      const rc = G.repairCost();
      body.innerHTML = `<div class="btnrow"><div style="flex:1"><h3>Hull</h3>${Math.max(0, Math.round(s.hull))} / ${G.hullMax} sound.</div><button class="pbtn" data-act="repair" ${rc > 0 && s.gold > 0 ? '' : 'disabled'}>${rc > 0 ? `Repair — ${Math.min(rc, s.gold)} gold` : 'Ship-shape'}</button></div><h3>Fitting out</h3><div class="cards">` + UPGRADES.map((u) => {
        const lv = s.upg[u.id], cost = G.upgradeCost(u.id);
        return `<div class="cardlet"><h4>${u.name}</h4><div class="lvl">${[0, 1, 2].map((i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div><p>${u.desc}<br><i>${u.levels[lv]}${cost !== null ? ' → ' + u.levels[lv + 1] : ''}</i></p>
          <div class="foot"><span>${cost !== null ? cost + ' gold' : 'Finest fitted'}</span>${cost !== null ? `<button class="pbtn sm" data-act="upgrade" data-id="${u.id}" ${s.gold >= cost ? '' : 'disabled'}>Fit</button>` : ''}</div></div>`;
      }).join('') + '</div>';
    } else {
      body.innerHTML = `<p>The tavern smells of tar, woodsmoke and fried fish. Someone in the corner is tuning a fiddle.</p>
        <div class="tavern-quote">${this.tavernText || '“Buy an old sailor a drink and he might remember something useful.”'}</div>
        <div class="btnrow"><button class="pbtn" data-act="rumour">Buy a round — 15 gold</button><button class="pbtn ghost" data-act="rest">Take a room until dawn</button></div>
        <p class="note">Rumours mark new islands on your chart. A night ashore passes the dark hours safely.</p>`;
    }
  }
  _harbourAction(e) {
    const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
    const G = this.game, h = this.harbourId, act = b.dataset.act, id = b.dataset.id, A = this.audio;
    let msg = '';
    if (act === 'accept') { const err = G.accept(h, id); if (err) msg = err; else { A.rope(); msg = 'Cargo loaded.'; } }
    if (act === 'buy') { if (G.buy(h, id, +b.dataset.n)) A.coin(); else msg = G.holdUsed() >= G.holdCap ? 'The hold is full.' : 'Not enough gold.'; }
    if (act === 'sell') { if (G.sell(h, id, +b.dataset.n)) A.coin(); }
    if (act === 'repair') { if (G.repair()) { A.thud(); msg = 'The shipwrights set to work.'; } }
    if (act === 'upgrade') { if (G.upgrade(id)) { A.quest(); msg = 'Fitted. She feels like a new boat.'; } }
    if (act === 'rumour') { A.coin(); this.tavernText = G.rumour(h); }
    if (act === 'rest') { this.hooks.rest(); return; }
    $('hb-msg').textContent = msg; this._renderHarbour();
  }
}

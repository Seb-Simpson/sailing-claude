// Fully procedural audio: sea, wind, rain, thunder, gulls, rigging, bells and generative music
import { clamp, lerp } from './util.js';

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PROG_CALM = [[38, 45, 54, 57, 64], [35, 47, 54, 57, 62], [43, 50, 54, 59, 62], [45, 52, 57, 59, 64]];
const PROG_DARK = [[35, 47, 50, 54, 57], [43, 47, 50, 55, 59], [40, 47, 52, 55, 59], [42, 49, 52, 57, 61]];
const PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81];

export class AudioSys {
  constructor() {
    this.ctx = null; this.vol = { master: 0.8, music: 0.55, sfx: 0.85 };
    this.t = 0; this.nextChord = 0; this.chordI = 0; this.nextPluck = 4; this.nextGull = 5; this.nextCreak = 6; this.flapT = 0;
    this.mood = 0; this.ready = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3.5;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.music = c.createGain(); this.sfx.connect(this.master); this.music.connect(this.master);
    // reverb
    const len = c.sampleRate * 3.2, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    const rg = c.createGain(); rg.gain.value = 0.55; this.rev.connect(rg); rg.connect(this.master);
    this.delay = c.createDelay(1.5); this.delay.delayTime.value = 0.46;
    const fb = c.createGain(); fb.gain.value = 0.36; this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(this.music); this.delay.connect(this.rev);
    // noise buffers
    const n = c.sampleRate * 3;
    this.white = c.createBuffer(1, n, c.sampleRate); this.brown = c.createBuffer(1, n, c.sampleRate);
    const w = this.white.getChannelData(0), b = this.brown.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
    const loop = (buf, type, freq, q) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.9 + Math.random() * 0.2;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.sfx); s.start();
      return { f, g };
    };
    this.L = {
      sea: loop(this.brown, 'lowpass', 420, 0.5), swash: loop(this.white, 'bandpass', 1300, 0.6),
      wind: loop(this.white, 'bandpass', 420, 0.9), whistle: loop(this.white, 'bandpass', 2300, 16),
      hull: loop(this.white, 'bandpass', 850, 0.6), rain: loop(this.white, 'highpass', 2600, 0.5), flap: loop(this.white, 'lowpass', 800, 0.7),
    };
    this.applyVolumes(); this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master; this.music.gain.value = this.vol.music * 0.9; this.sfx.gain.value = this.vol.sfx;
  }

  _set(node, v, tc = 0.25) { node.gain.setTargetAtTime(v, this.ctx.currentTime, tc); }

  update(dt, e) {
    if (!this.ready) return;
    const c = this.ctx, L = this.L; this.t += dt; const t = this.t;
    const w = clamp(e.wind / 20, 0, 1.2), game = e.menu ? 0.55 : 1;
    const swell = Math.pow(Math.sin(t * 0.8 + Math.sin(t * 0.21) * 2) * 0.5 + 0.5, 2);
    this._set(L.sea.g, (0.22 + 0.5 * e.wave * 0.5) * game);
    this._set(L.swash.g, (0.012 + 0.05 * swell * (0.4 + e.wave * 0.5) + e.shore * 0.06 * swell) * game);
    L.swash.f.frequency.setTargetAtTime(900 + swell * 900, c.currentTime, 0.4);
    const gust = 0.75 + 0.25 * Math.sin(t * 0.7 + Math.sin(t * 0.31) * 3);
    this._set(L.wind.g, (0.02 + w * w * 0.55) * gust * game);
    L.wind.f.frequency.setTargetAtTime(280 + w * 520 * gust, c.currentTime, 0.5);
    this._set(L.whistle.g, Math.max(0, w - 0.5) * 0.09 * gust);
    L.whistle.f.frequency.setTargetAtTime(1900 + w * 900 * gust, c.currentTime, 0.3);
    const sp = clamp(Math.abs(e.speed) / 9, 0, 1.2);
    this._set(L.hull.g, sp * sp * 0.17);
    L.hull.f.frequency.setTargetAtTime(600 + sp * 700, c.currentTime, 0.3);
    this._set(L.rain.g, e.rain * 0.16);
    this.flapT -= dt;
    if (this.flapT <= 0) { this.flapT = 0.07 + Math.random() * 0.09; this._set(L.flap.g, e.luff * (0.05 + Math.random() * 0.22) * clamp(e.wind / 9, 0.3, 1.4), 0.03); }

    // gulls
    this.nextGull -= dt;
    if (this.nextGull <= 0) { this.nextGull = 3 + Math.random() * 9; if (e.gulls > 0.05 && e.day > 0.3 && e.storm < 0.5) this.gull(e.gulls); }
    this.nextCreak -= dt;
    if (this.nextCreak <= 0) { this.nextCreak = 4 + Math.random() * 9 / (0.4 + e.wave); if (!e.menu) this.creak(0.3 + e.wave * 0.3); }

    // music
    this.mood = lerp(this.mood, e.storm > 0.5 ? 1 : 0, dt * 0.2);
    if (t >= this.nextChord) {
      const dark = this.mood > 0.5, prog = dark ? PROG_DARK : PROG_CALM;
      const ch = prog[this.chordI++ % prog.length], dur = dark ? 11 : 9.5;
      this.nextChord = t + dur;
      ch.forEach((m, i) => this._pad(mtof(m + (e.night > 0.6 && i > 1 ? 0 : 0)), dur, i === 0 ? 0.075 : 0.042, dark));
      this.root = ch[0];
    }
    if (t >= this.nextPluck) {
      this.nextPluck = t + (1.1 + Math.random() * 3.8) * (1 + e.night * 0.8) * (this.mood > 0.5 ? 2.5 : 1);
      const note = PENTA[Math.floor(Math.random() * PENTA.length)] + (this.mood > 0.5 ? -1 : 0);
      this._pluck(mtof(note), 0.05 + Math.random() * 0.04);
      if (Math.random() < 0.3) this._pluck(mtof(note + [3, 5, 7][Math.floor(Math.random() * 3)]), 0.035, 0.23);
    }
  }

  _pad(freq, dur, vol, dark) {
    const c = this.ctx, t0 = c.currentTime, g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = dark ? 700 : 1300; f.Q.value = 0.4;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.35); g.gain.setTargetAtTime(0, t0 + dur * 0.8, dur * 0.25);
    for (const [type, det] of [['sine', 0], ['triangle', 5], ['sawtooth', -6]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.detune.value = det + (Math.random() - 0.5) * 6;
      const og = c.createGain(); og.gain.value = type === 'sawtooth' ? 0.12 : 0.5; o.connect(og); og.connect(f); o.start(t0); o.stop(t0 + dur * 2.2);
    }
    f.connect(g); g.connect(this.music); g.connect(this.rev);
  }

  _pluck(freq, vol, delay = 0) {
    const c = this.ctx, t0 = c.currentTime + delay, o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = freq; o2.type = 'sine'; o2.frequency.value = freq * 2.001;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
    const g2 = c.createGain(); g2.gain.value = 0.25; o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(this.music); g.connect(this.delay); g.connect(this.rev);
    o.start(t0); o2.start(t0); o.stop(t0 + 2.5); o2.stop(t0 + 2.5);
  }

  _noiseBurst(type, f0, f1, dur, vol, delay = 0, q = 0.7, rev = false) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime + delay, s = c.createBufferSource(); s.buffer = this.white; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.05, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); if (rev) g.connect(this.rev);
    s.start(t0, Math.random() * 2); s.stop(t0 + dur + 0.1);
  }

  _tone(freq, dur, vol, type = 'sine', delay = 0, rev = true, slideTo = 0) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(this.sfx); if (rev) g.connect(this.rev); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  thunder(dist) {
    const delay = Math.min(dist / 340, 7), v = clamp(1.3 / (1 + dist / 700), 0.15, 1);
    this._noiseBurst('lowpass', 1400 * v + 200, 60, 0.5, v * 0.9, delay, 0.5, true);
    for (let i = 0; i < 4; i++) this._noiseBurst('lowpass', 500 * v + 120, 45, 2.5 + Math.random() * 3, v * (0.8 - i * 0.12), delay + 0.1 + i * (0.35 + Math.random() * 0.5), 0.6, true);
  }
  splash(p = 1) { this._noiseBurst('lowpass', 2600, 500, 0.5 + p * 0.3, 0.12 * p, 0, 0.5); this._noiseBurst('bandpass', 5000, 2500, 0.35, 0.05 * p, 0.04, 0.8); }
  thud() { this._tone(70, 0.4, 0.5, 'sine', 0, false, 38); this._noiseBurst('lowpass', 900, 150, 0.35, 0.3); }
  creak(v = 0.4) {
    if (!this.ready) return;
    const c = this.ctx, t0 = c.currentTime, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; const base = 55 + Math.random() * 50; o.frequency.setValueAtTime(base, t0); o.frequency.linearRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t0 + 0.5);
    f.type = 'bandpass'; f.frequency.value = 500 + Math.random() * 700; f.Q.value = 9;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.05 * v, t0 + 0.1); g.gain.linearRampToValueAtTime(0, t0 + 0.55);
    o.connect(f); f.connect(g); g.connect(this.sfx); o.start(t0); o.stop(t0 + 0.6);
  }
  gull(near = 1) {
    if (!this.ready) return;
    const c = this.ctx, n = 2 + Math.floor(Math.random() * 4), pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const out = c.createGain(); out.gain.value = 0.05 * near;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan); pan.connect(this.sfx); pan.connect(this.rev); } else out.connect(this.sfx);
    const base = 1500 + Math.random() * 500;
    for (let i = 0; i < n; i++) {
      const t0 = c.currentTime + i * (0.27 + Math.random() * 0.06), o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(base * 0.8, t0); o.frequency.linearRampToValueAtTime(base * 1.25, t0 + 0.07); o.frequency.linearRampToValueAtTime(base * (0.78 - i * 0.02), t0 + 0.24);
      f.type = 'bandpass'; f.frequency.value = base * 1.5; f.Q.value = 4;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(1, t0 + 0.04); g.gain.linearRampToValueAtTime(0, t0 + 0.25);
      o.connect(f); f.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 0.3);
    }
  }
  bell(f0 = 520, vol = 0.14) { [[1, 1, 2.6], [2.0, 0.5, 1.8], [2.76, 0.35, 1.3], [5.4, 0.2, 0.8], [8.9, 0.1, 0.4]].forEach(([r, v, d]) => this._tone(f0 * r, d, vol * v)); }
  click() { this._tone(880, 0.06, 0.08, 'sine', 0, false); }
  hover() { this._tone(1320, 0.03, 0.025, 'sine', 0, false); }
  coin() { this._tone(1568, 0.12, 0.09, 'triangle'); this._tone(2093, 0.3, 0.09, 'triangle', 0.07); }
  rope() { this._noiseBurst('bandpass', 700, 1800, 0.35, 0.12, 0, 2); }
  pickup() { [74, 78, 81].forEach((m, i) => this._tone(mtof(m), 0.6, 0.08, 'triangle', i * 0.07)); }
  discover() { [62, 66, 69, 74, 78].forEach((m, i) => { this._tone(mtof(m), 2.2, 0.1, 'sine', i * 0.13); this._tone(mtof(m) * 2, 1.2, 0.03, 'triangle', i * 0.13); }); }
  quest() { [[62, 0], [69, 0.16], [74, 0.32], [78, 0.48], [81, 0.72]].forEach(([m, d]) => this._tone(mtof(m), 2.6, 0.11, 'triangle', d)); this.bell(293, 0.1); }
  ignite() {
    this._noiseBurst('bandpass', 200, 3200, 2.6, 0.3, 0, 1.2, true);
    this._tone(73.4, 5, 0.3, 'sine', 0, true, 146.8);
    [62, 69, 74, 78, 81, 86].forEach((m, i) => this._tone(mtof(m), 4, 0.09, 'sine', 0.8 + i * 0.22));
  }
  warn() { this._tone(330, 0.25, 0.1, 'triangle', 0, false); this._tone(262, 0.4, 0.1, 'triangle', 0.2, false); }
}

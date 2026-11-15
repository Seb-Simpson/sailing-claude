// Game state, persistence, quests, economy and discovery
import { ISLANDS, HARBOURS, BEACONS, GOODS, PRICE_MULT, UPGRADES, HOLD_CAP, HULL_MAX, SIGHT, RANKS, BOTTLES, RUMOURS, BEACON_LORE, VEIL_RADIUS, WORLD_SIZE } from './config.js';
import { clamp, smoothstep, mulberry32, hash2, bearingTo, KNOTS } from './util.js';

const SAVE_KEY = 'beyond-the-horizon-save-v1';
export const FOG_N = 64;
const CARGO_LABELS = ['lamp oil', 'mail sacks', 'medicine', 'sailcloth', 'seed grain', 'a brass telescope', 'wedding gifts', 'clockwork parts', 'salted lemons', 'a crated piano'];

export class Game {
  constructor(world) {
    this.world = world;
    this.listeners = [];
    this.s = null;
    this.flotsamDefs = this._genFlotsam();
    this.veil = 0; this.edgeCalm = 0; this._veilWarned = 0; this._saveT = 0;
    this.near = null; // nearest island info
  }
  on(fn) { this.listeners.push(fn); }
  emit(type, data = {}) { for (const fn of this.listeners) fn(type, data); }

  // ---------- persistence ----------
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  fresh() {
    const d = this.world.byId.haven.dock;
    return {
      v: 1, gold: 120, hull: 100, x: d.berthX, z: d.berthZ, heading: d.heading, hour: 7.6, day: 1, weather: null,
      upg: { sails: 0, keel: 0, hull: 0, hold: 0, spyglass: 0 }, cargo: {}, discovered: { haven: 1 }, charted: { haven: 1 },
      beacons: {}, wrecks: {}, bottles: [], pickups: {}, contracts: [], offers: {}, rumours: {},
      quest: 0, tut: 0, renown: 0, stats: { dist: 0, time: 0, maxKn: 0, profit: 0, deliveries: 0, storms: 0 },
      explored: '', docked: null, lastHarbour: 'haven', finished: false, autoTrim: false, sailLevel: 0, sheet: 0.5, anchored: true,
    };
  }
  newGame() { this.s = this.fresh(); this.fog = new Uint8Array(FOG_N * FOG_N); this.reveal(this.s.x, this.s.z, 700); this._sync(); }
  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY); if (!raw) return false;
      const s = JSON.parse(raw); if (!s || s.v !== 1) return false;
      this.s = Object.assign(this.fresh(), s);
      this.fog = new Uint8Array(FOG_N * FOG_N);
      if (s.explored) { const bin = atob(s.explored); for (let i = 0; i < this.fog.length; i++) this.fog[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1; }
      this._sync(); return true;
    } catch (e) { console.warn('Save could not be loaded', e); return false; }
  }
  save(boat, weather) {
    if (!this.s) return;
    const s = this.s;
    if (boat) { s.x = boat.pos.x; s.z = boat.pos.z; s.heading = boat.heading; s.sailLevel = boat.sailLevel; s.sheet = boat.sheet; s.autoTrim = boat.autoTrim; s.anchored = boat.anchored; }
    if (weather) s.weather = weather.serialize();
    let bin = '';
    for (let i = 0; i < this.fog.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b |= (this.fog[i + k] ? 1 : 0) << k; bin += String.fromCharCode(b); }
    s.explored = btoa(bin);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) { /* storage unavailable */ }
  }
  wipe() { try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ } }

  _sync() { // push state into the world
    for (const id of BEACONS) this.world.setBeaconLit(id, !!this.s.beacons[id], true);
    for (const isl of this.world.islands) if (isl.wreck) isl.wreck.looted = !!this.s.wrecks[isl.id];
    this.fogDirty = true;
  }

  // ---------- derived ----------
  get hullMax() { return HULL_MAX[this.s.upg.hull]; }
  get holdCap() { return HOLD_CAP[this.s.upg.hold]; }
  get sight() { return SIGHT[this.s.upg.spyglass]; }
  get beaconCount() { return BEACONS.filter((b) => this.s.beacons[b]).length; }
  get veilOpen() { return this.s.quest >= 3; }
  holdUsed() { let n = 0; for (const k in this.s.cargo) n += this.s.cargo[k]; for (const c of this.s.contracts) n += c.crates; return n; }
  rank() { let r = RANKS[0], next = null; for (const k of RANKS) { if (this.s.renown >= k.at) r = k; else { next = k; break; } } return { name: r.name, next }; }
  addRenown(n) { const before = this.rank().name; this.s.renown += n; const after = this.rank().name; if (after !== before) this.emit('toast', { text: `You are now known as: ${after}`, kind: 'gold' }); }
  addGold(n) { this.s.gold = Math.max(0, Math.round(this.s.gold + n)); }

  // ---------- fog of war ----------
  reveal(x, z, radius) {
    const cell = WORLD_SIZE / FOG_N, cx = (x + WORLD_SIZE / 2) / cell, cz = (z + WORLD_SIZE / 2) / cell, r = radius / cell;
    for (let j = Math.max(0, Math.floor(cz - r)); j <= Math.min(FOG_N - 1, Math.ceil(cz + r)); j++)
      for (let i = Math.max(0, Math.floor(cx - r)); i <= Math.min(FOG_N - 1, Math.ceil(cx + r)); i++) {
        if (this.fog[j * FOG_N + i]) continue;
        if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cz) ** 2 <= r * r) { this.fog[j * FOG_N + i] = 1; this.fogDirty = true; }
      }
  }

  // ---------- flotsam ----------
  _genFlotsam() {
    const r = mulberry32(4242), out = [];
    const spot = (minD, maxD) => {
      for (let t = 0; t < 200; t++) {
        const a = r() * Math.PI * 2, d = minD + Math.sqrt(r()) * (maxD - minD), x = Math.cos(a) * d, z = Math.sin(a) * d;
        if (this.world.heightAt(x, z) < -12) return [x, z];
      }
      return [600, 600];
    };
    BOTTLES.forEach((b, i) => { const [x, z] = i === 0 ? [this.world.tutorialBuoy.x + 120, this.world.tutorialBuoy.z + 150] : spot(500 + i * 150, 1300 + i * 280); out.push({ id: 'b' + i, type: 'bottle', x, z, n: i }); });
    for (let i = 0; i < 40; i++) { const [x, z] = spot(250, 4500); out.push({ id: 'f' + i, type: i % 3 === 0 ? 'crate' : 'barrel', x, z }); }
    return out;
  }
  flotsamActive(def) {
    if (def.type === 'bottle') return !this.s.bottles.includes(def.n);
    const d = this.s.pickups[def.id]; return !d || this.s.day - d >= 2;
  }
  collect(def) {
    const s = this.s;
    if (def.type === 'bottle') {
      s.bottles.push(def.n); this.addRenown(30);
      const b = BOTTLES[def.n];
      this.emit('story', { kicker: 'Message in a bottle', title: b.title, text: b.text, button: 'Keep it in the journal' });
      if (s.bottles.length === BOTTLES.length) this.emit('toast', { text: 'Every bottle found. The Marigold’s story is complete.', kind: 'gold' });
      return;
    }
    s.pickups[def.id] = s.day;
    const rnd = hash2(def.x | 0, s.day * 7 + (def.z | 0));
    if (def.type === 'crate' && this.holdUsed() < this.holdCap) {
      const g = GOODS[Math.floor(rnd * 4.99)], n = Math.min(1 + Math.floor(rnd * 7) % 2, this.holdCap - this.holdUsed());
      s.cargo[g.id] = (s.cargo[g.id] || 0) + n;
      this.emit('toast', { text: `Salvaged ${n} × ${g.name}`, kind: 'good' });
    } else {
      const gold = 14 + Math.floor(rnd * 38); this.addGold(gold);
      this.emit('toast', { text: `Flotsam: +${gold} gold`, kind: 'good' });
    }
    this.addRenown(4);
  }

  // ---------- economy ----------
  price(h, g, selling) {
    const good = GOODS.find((x) => x.id === g), wob = 0.9 + 0.2 * hash2(this.s.day * 31 + g.length * 7, h.length * 13 + g.charCodeAt(0));
    const p = good.base * PRICE_MULT[h][g] * wob;
    return Math.max(1, Math.round(selling ? p * 0.92 : p));
  }
  buy(h, g, n = 1) {
    const p = this.price(h, g); n = Math.min(n, this.holdCap - this.holdUsed(), Math.floor(this.s.gold / p));
    if (n <= 0) return false;
    this.s.gold -= p * n; this.s.cargo[g] = (this.s.cargo[g] || 0) + n; this.s.stats.profit -= p * n; return true;
  }
  sell(h, g, n = 1) {
    n = Math.min(n, this.s.cargo[g] || 0); if (n <= 0) return false;
    const p = this.price(h, g, true);
    this.s.gold += p * n; this.s.cargo[g] -= n; if (!this.s.cargo[g]) delete this.s.cargo[g]; this.s.stats.profit += p * n; this.addRenown(Math.ceil(p * n / 40)); return true;
  }
  offers(h) {
    const s = this.s;
    if (!s.offers[h] || s.offers[h].day !== s.day) {
      const r = mulberry32(s.day * 977 + h.length * 131 + h.charCodeAt(1)), from = this.world.byId[h].def, list = [];
      const dests = HARBOURS.filter((x) => x !== h);
      for (let i = 0; i < 3; i++) {
        const to = dests[Math.floor(r() * dests.length)], T = this.world.byId[to].def;
        const dist = Math.hypot(T.x - from.x, T.z - from.z), crates = 1 + Math.floor(r() * 4);
        list.push({ id: `${h}-${s.day}-${i}`, from: h, to, label: CARGO_LABELS[Math.floor(r() * CARGO_LABELS.length)], crates, reward: Math.round((30 + dist * 0.036) * (0.85 + crates * 0.12)) });
      }
      s.offers[h] = { day: s.day, list, taken: [] };
    }
    return s.offers[h];
  }
  accept(h, id) {
    const o = this.offers(h), c = o.list.find((x) => x.id === id);
    if (!c || o.taken.includes(id)) return 'gone';
    if (this.s.contracts.length >= 3) return 'You can carry three contracts at a time.';
    if (this.holdUsed() + c.crates > this.holdCap) return 'Not enough room in the hold.';
    o.taken.push(id); this.s.contracts.push(c);
    this.s.charted[c.to] = 1; this.fogDirty = true;
    return null;
  }
  deliver(h) {
    const done = this.s.contracts.filter((c) => c.to === h); if (!done.length) return;
    this.s.contracts = this.s.contracts.filter((c) => c.to !== h);
    let total = 0; for (const c of done) total += c.reward;
    this.addGold(total); this.s.stats.deliveries += done.length; this.s.stats.profit += total; this.addRenown(25 * done.length);
    this.emit('toast', { text: `Delivered ${done.length} contract${done.length > 1 ? 's' : ''}: +${total} gold`, kind: 'gold' }); this.emit('sfx', { name: 'coin' });
  }
  upgradeCost(id) { const u = UPGRADES.find((x) => x.id === id), lv = this.s.upg[id]; return lv >= 3 ? null : u.costs[lv]; }
  upgrade(id) {
    const c = this.upgradeCost(id); if (c === null || this.s.gold < c) return false;
    this.s.gold -= c; this.s.upg[id]++; if (id === 'hull') this.s.hull = this.hullMax; this.addRenown(40); this.emit('upgrade'); return true;
  }
  repairCost() { return Math.ceil((this.hullMax - this.s.hull) * 1.1); }
  repair() { const c = Math.min(this.repairCost(), this.s.gold); if (c <= 0) return false; this.s.gold -= c; this.s.hull = Math.min(this.hullMax, this.s.hull + c / 1.1); return true; }
  rumour(h) {
    if (this.s.gold < 15) return 'The barkeep eyes your empty purse and says nothing.';
    const next = RUMOURS[h].find((id) => !this.s.charted[id] && !this.s.discovered[id]);
    if (!next) return 'Old stories, all of them told before. You have heard everything this tavern knows.';
    this.s.gold -= 15; this.s.charted[next] = 1; this.fogDirty = true;
    const I = this.world.byId[next].def, from = this.world.byId[h].def;
    const b = (bearingTo(from.x, from.z, I.x, I.z) * 180 / Math.PI + 360) % 360;
    const dir = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(b / 45) % 8];
    return `“${I.name}? Aye. Sail ${dir} from here, a good ${(Math.hypot(I.x - from.x, I.z - from.z) / 1852).toFixed(1)} sea-miles. ${I.blurb}”  — marked on your chart.`;
  }
  rest() { this.s.hour = 6.4; this.s.day++; }

  damage(n, why) {
    const s = this.s; if (s.docked) return;
    const k = 1 - 0.12 * s.upg.hull;
    s.hull -= n * k;
    if (n > 2) this.emit('damage', { amount: n * k, why });
    if (s.hull <= 0) this.emit('wrecked');
  }
  shipwreck() {
    const s = this.s, lost = Math.round(s.gold * 0.3);
    s.gold -= lost; s.cargo = {}; s.hull = this.hullMax * 0.6;
    const d = this.world.byId[s.lastHarbour].dock; s.x = d.berthX; s.z = d.berthZ; s.heading = d.heading;
    return lost;
  }

  // ---------- interactions ----------
  interaction(boat) {
    const p = boat.pos, sp = Math.abs(boat.speed);
    let best = null;
    for (const isl of this.world.islands) {
      const I = isl.def; if (Math.abs(p.x - I.x) > I.r * 2 + 300 || Math.abs(p.z - I.z) > I.r * 2 + 300) continue;
      if (isl.dock) {
        const d = Math.hypot(p.x - isl.dock.x, p.z - isl.dock.z);
        if (d < 62) best = sp < 4.2 ? { type: 'dock', id: I.id, label: `Dock at ${I.name}` } : { type: 'none', label: 'Too fast to dock — ease sheets or lower sail' };
      }
      if (isl.beacon && !this.s.beacons[I.id]) {
        const d = Math.hypot(p.x - isl.beacon.x, p.z - isl.beacon.z);
        if (d < isl.beacon.reach) best = { type: 'beacon', id: I.id, label: 'Light the ancient beacon' };
      }
      if (isl.wreck && !this.s.wrecks[I.id]) {
        const d = Math.hypot(p.x - isl.wreck.x, p.z - isl.wreck.z);
        if (d < 70) best = { type: 'wreck', id: I.id, label: 'Search the wreck' };
      }
    }
    return best;
  }
  lightBeacon(id) {
    const s = this.s; if (s.beacons[id]) return;
    s.beacons[id] = 1; this.world.setBeaconLit(id, true);
    const n = this.beaconCount; this.addGold(150); this.addRenown(200);
    this.emit('sfx', { name: 'ignite' });
    let text = BEACON_LORE[id] + `\n\n${n} of 5 beacons burn. (+150 gold)`;
    const next = BEACONS.find((b) => !s.beacons[b]);
    if (next) {
      if (!s.charted[next]) { s.charted[next] = 1; this.fogDirty = true; text += `\n\nThe beam leans, just slightly, toward another fire: ${this.world.byId[next].def.name} is marked on your chart.`; }
    }
    if (n >= 5) {
      s.quest = 3; s.charted.edge = 1; this.fogDirty = true;
      text += '\n\nFive pillars of light meet high above the sea. Far to the north, the Veil tears open like a curtain.';
    }
    this.emit('story', { kicker: `Beacon ${n} of 5`, title: `${this.world.byId[id].def.name} burns again`, text, button: n >= 5 ? 'North, then' : 'Sail on', delay: 1.2 });
    if (n >= 5) this.emit('quest', { title: 'Beyond the Horizon' });
  }
  lootWreck(id) {
    const s = this.s; if (s.wrecks[id]) return;
    s.wrecks[id] = 1; this.world.byId[id].wreck.looted = true;
    const gold = 180 + Math.floor(hash2(id.length * 9, id.charCodeAt(0)) * 240); this.addGold(gold); this.addRenown(90);
    const room = Math.min(3, this.holdCap - this.holdUsed());
    if (room > 0) s.cargo.pearls = (s.cargo.pearls || 0) + room;
    this.emit('sfx', { name: 'coin' });
    this.emit('story', { kicker: 'Shipwreck', title: `The wreck at ${this.world.byId[id].def.name}`, text: `You go over the side with a line round your waist. In the drowned cabin: a strongbox, green with weed.\n\n+${gold} gold${room > 0 ? ` and ${room} crates of pearls` : ''}.`, button: 'Back aboard' });
  }

  // ---------- quest text ----------
  objective() {
    const s = this.s, W = this.world;
    if (s.quest === 0) {
      const b = W.tutorialBuoy;
      return [
        { title: 'Cast Off', text: 'Raise your sail with E.' },
        { title: 'Cast Off', text: 'Catch the wind: ease (W) or haul in (S) the sheet until the trim gauge turns green.' },
        { title: 'Cast Off', text: 'Steer with A and D. Round the yellow buoy outside the harbour.', target: { x: b.x, z: b.z } },
      ][Math.min(s.tut, 2)];
    }
    if (s.quest === 1) { const I = W.byId.gull.def; return { title: 'The Keeper of Gull Rock', text: 'Sail to the lighthouse on Gull Rock, north-east of Port Haven.', target: { x: I.x, z: I.z } }; }
    if (s.quest === 2) {
      const next = BEACONS.find((b) => !s.beacons[b] && (s.charted[b] || s.discovered[b]));
      const n = this.beaconCount;
      if (next) { const bc = W.byId[next].beacon; return { title: `Five Fires  (${n}/5)`, text: `Light the ancient beacon on ${W.byId[next].def.name}.`, target: { x: bc.x, z: bc.z } }; }
      return { title: `Five Fires  (${n}/5)`, text: 'Find the remaining beacons. Tavern rumours and bottles may point the way.' };
    }
    if (s.quest === 3) { const I = W.byId.edge.def; return { title: 'Beyond the Horizon', text: 'The Veil has parted in the north. Sail through.', target: { x: I.x, z: I.z } }; }
    const left = ISLANDS.filter((I) => !s.discovered[I.id]).length;
    return { title: 'Free Sailing', text: left ? `${left} island${left > 1 ? 's' : ''} still uncharted. The sea is yours.` : 'Every island charted. The sea is yours.' };
  }

  // ---------- per-frame ----------
  update(dt, boat, weather) {
    const s = this.s, p = boat.pos;
    s.stats.time += dt; s.stats.dist += Math.abs(boat.speed) * dt;
    const kn = Math.abs(boat.speed) * KNOTS; if (kn > s.stats.maxKn) s.stats.maxKn = kn;
    this.reveal(p.x, p.z, this.sight);

    // nearest island + discovery
    let near = null, nd = 1e9;
    for (const isl of this.world.islands) {
      const I = isl.def, d = Math.hypot(p.x - I.x, p.z - I.z) - I.r;
      if (d < nd) { nd = d; near = isl; }
      if (!s.discovered[I.id] && d < 190 + this.sight * 0.35 && !(I.hidden && !this.veilOpen)) {
        s.discovered[I.id] = 1; s.charted[I.id] = 1; this.fogDirty = true;
        this.addRenown(60); this.addGold(25);
        this.emit('discover', { name: I.name, blurb: I.blurb, id: I.id });
        if (isl.dock) s.charted[I.id] = 1;
      }
    }
    this.near = near; this.nearDist = nd;

    // tutorial + story beats
    if (s.quest === 0) {
      if (s.tut === 0 && boat.sailLevel > 0) s.tut = 1;
      if (s.tut === 1 && Math.abs(boat.speed) > 1.8) s.tut = 2;
      const b = this.world.tutorialBuoy;
      if (Math.hypot(p.x - b.x, p.z - b.z) < 45) {
        s.quest = 1; s.tut = 3; this.addGold(40); this.addRenown(40);
        this.emit('quest', { title: 'The Keeper of Gull Rock' });
        this.emit('toast', { text: 'Well sailed! The keeper of Gull Rock has been asking for you.', kind: 'gold' });
      }
    } else if (s.quest === 1 && s.discovered.gull && Math.hypot(p.x - this.world.byId.gull.def.x, p.z - this.world.byId.gull.def.z) < 420) {
      s.quest = 2; s.charted.coral = 1; this.fogDirty = true; this.addGold(60);
      this.emit('story', { kicker: 'Gull Rock', title: 'The Keeper', delay: 2.5,
        text: 'The keeper rows out to meet you, pipe clenched in his teeth.\n\n“So you’re the one with Maren’s look about you. She came through here once, chasing the five old fires. Lit four. Never the fifth.”\n\nHe presses a folded chart into your hand. “Coral Crown, north-west. Start there. Light all five and the Veil will open — or so my grandmother swore.”\n\nCoral Crown is marked on your chart. (+60 gold)', button: 'Take the chart' });
      this.emit('quest', { title: 'Five Fires' });
    } else if (s.quest === 3) {
      const I = this.world.byId.edge.def;
      if (Math.hypot(p.x - I.x, p.z - I.z) < I.r + 170) {
        s.quest = 4; s.finished = true; this.addRenown(1000); this.addGold(1000);
        this.emit('ending');
      }
    }

    // the Veil
    const d0 = Math.hypot(p.x, p.z);
    let veil = smoothstep(VEIL_RADIUS - 700, VEIL_RADIUS + 100, d0);
    if (this.veilOpen) {
      const ang = Math.abs(Math.atan2(p.x, -p.z));
      veil *= smoothstep(0.2, 0.42, ang);
    }
    this.veil = veil;
    const E = this.world.byId.edge.def;
    this.edgeCalm = this.veilOpen ? smoothstep(1700, 600, Math.hypot(p.x - E.x, p.z - E.z)) : 0;
    boat.ext.set(0, 0, 0);
    const lim = this.veilOpen && veil < 0.5 ? VEIL_RADIUS + 1600 : VEIL_RADIUS;
    if (d0 > lim) {
      const k = Math.min((d0 - lim) * 0.012, 4.5);
      boat.ext.set(-p.x / d0 * k, 0, -p.z / d0 * k);
      this._veilWarned -= dt;
      if (this._veilWarned <= 0) {
        this._veilWarned = 30;
        this.emit('toast', { text: this.veilOpen ? 'The Veil closes in on either side. Keep to the northern passage.' : 'The Veil turns you back. No ship has crossed it — not while the five fires are cold.', kind: 'warn' });
      }
    }

    this._saveT += dt;
    if (this._saveT > 20) { this._saveT = 0; this.save(boat, weather); }
  }
}

// World definition and game data for Beyond the Horizon
export const WORLD_SIZE = 12800;      // metres, square centred on origin
export const HEIGHTMAP_RES = 2048;
export const SEA_FLOOR = -38;
export const VEIL_RADIUS = 4900;      // the storm wall that rings the known sea
export const DAY_SECONDS = 20 * 60;   // real seconds per in-game day

// bearing angles are compass degrees from island centre (0 = N, 90 = E)
export const ISLANDS = [
  { id: 'haven', name: 'Port Haven', type: 'hills', x: 0, z: 0, r: 380, H: 58, seed: 11, harbour: 150, trees: 'mixed',
    blurb: 'Home waters. Every voyage worth telling began at this quay.' },
  { id: 'gull', name: 'Gull Rock', type: 'cliffs', x: 820, z: -640, r: 150, H: 24, seed: 23, lighthouse: 200, trees: 'sparse',
    blurb: 'A stubborn rock and a stubborn keeper. The lamp has not failed in forty years.' },
  { id: 'saffron', name: 'Saffron Cay', type: 'cay', x: -1650, z: 950, r: 310, H: 9, seed: 37, harbour: 60, trees: 'palm',
    blurb: 'Warm sand, warmer spice. The cay trades in saffron, cinnamon and gossip.' },
  { id: 'coral', name: 'Coral Crown', type: 'atoll', x: -1000, z: -1950, r: 340, H: 6, seed: 41, beacon: 110, trees: 'palm',
    blurb: 'A ring of white sand around a lagoon the colour of sea-glass.' },
  { id: 'ember', name: 'Emberfall', type: 'volcano', x: 2050, z: 1550, r: 520, H: 215, seed: 53, beacon: 300, trees: 'mixed',
    blurb: 'The mountain sleeps, but its shoulders are still warm.' },
  { id: 'thorn', name: 'Thornwall', type: 'cliffs', x: 2500, z: -1400, r: 400, H: 68, seed: 67, harbour: 250, trees: 'pine',
    blurb: 'A fortress of basalt. Its weavers make the finest silk on the sea.' },
  { id: 'sisters', name: 'The Sisters', type: 'stacks', x: 650, z: 2700, r: 380, H: 62, seed: 71, wreck: 330, trees: 'sparse',
    blurb: 'Seven stone sisters wading out to sea. Count them twice; sailors swear the number changes.' },
  { id: 'mistral', name: 'Mistral Reach', type: 'hills', x: -3000, z: -800, r: 450, H: 84, seed: 83, harbour: 100, lighthouse: 300, trees: 'pine',
    blurb: 'Pearl divers and hard west winds. The Reach never sleeps quietly.' },
  { id: 'whisper', name: 'Whisperpine', type: 'hills', x: -2400, z: 2600, r: 420, H: 96, seed: 97, beacon: 40, trees: 'pine',
    blurb: 'The pines here lean together as if sharing a secret.' },
  { id: 'tooth', name: 'Old Tooth', type: 'cliffs', x: 3500, z: 500, r: 230, H: 105, seed: 101, beacon: 260, trees: 'sparse',
    blurb: 'One great fang of rock, older than any chart.' },
  { id: 'lantern', name: 'Lantern Shoals', type: 'stacks', x: 300, z: -3100, r: 360, H: 7, seed: 113, wreck: 170, trees: 'palm', sandy: true,
    blurb: 'Low sandbars that glow at dusk. Many keels have found them in the dark.' },
  { id: 'kestrel', name: "Kestrel's Rest", type: 'hills', x: 1750, z: -3300, r: 360, H: 60, seed: 127, harbour: 215, trees: 'mixed',
    blurb: 'A rum-maker’s island with a generous harbour and a long memory.' },
  { id: 'frost', name: 'Frostspire', type: 'peak', x: -1950, z: -3500, r: 430, H: 195, seed: 131, beacon: 120, trees: 'pine', snow: true,
    blurb: 'Snow in summer. The spire catches every cloud that crosses the northern sea.' },
  { id: 'bell', name: 'The Drowned Bell', type: 'stacks', x: -3650, z: 1300, r: 260, H: 16, seed: 139, wreck: 80, trees: 'sparse',
    blurb: 'On still nights you can hear a bell tolling beneath the water.' },
  { id: 'widow', name: "Widow's Teeth", type: 'stacks', x: 3200, z: 2900, r: 300, H: 46, seed: 149, wreck: 290, trees: 'sparse',
    blurb: 'Black rocks in white water. Give them a wide berth.' },
  { id: 'edge', name: "Horizon's Edge", type: 'hills', x: 0, z: -5750, r: 300, H: 34, seed: 157, gate: true, trees: 'none', hidden: true,
    blurb: 'Where the charts end, and the sea keeps going.' },
];

export const HARBOURS = ['haven', 'saffron', 'thorn', 'mistral', 'kestrel'];
export const BEACONS = ['coral', 'ember', 'whisper', 'tooth', 'frost'];

export const GOODS = [
  { id: 'timber', name: 'Timber', base: 12 },
  { id: 'fish', name: 'Salt Fish', base: 18 },
  { id: 'spice', name: 'Spice', base: 40 },
  { id: 'rum', name: 'Rum', base: 55 },
  { id: 'silk', name: 'Silk', base: 90 },
  { id: 'pearls', name: 'Pearls', base: 140 },
];

export const PRICE_MULT = {
  haven:   { timber: 0.70, fish: 0.80, spice: 1.20, rum: 1.00, silk: 1.15, pearls: 1.20 },
  saffron: { timber: 1.45, fish: 1.20, spice: 0.60, rum: 0.78, silk: 1.00, pearls: 0.92 },
  thorn:   { timber: 1.10, fish: 1.35, spice: 1.25, rum: 1.20, silk: 0.62, pearls: 1.10 },
  mistral: { timber: 1.25, fish: 0.70, spice: 1.10, rum: 1.30, silk: 1.25, pearls: 0.60 },
  kestrel: { timber: 0.80, fish: 1.00, spice: 0.90, rum: 0.62, silk: 1.20, pearls: 1.30 },
};

export const UPGRADES = [
  { id: 'sails', name: 'Sailcloth', desc: 'Finer cloth catches more wind. More drive on every point of sail.',
    levels: ['Worn canvas', 'Flax weave', 'Tanbark cotton', 'Thornwall silk'], costs: [320, 850, 1900] },
  { id: 'keel', name: 'Keel & Ballast', desc: 'A deeper keel points higher, heels less and turns more sweetly.',
    levels: ['Shoal keel', 'Oak keel', 'Lead-shod keel', 'Master’s fin keel'], costs: [280, 760, 1700] },
  { id: 'hull', name: 'Hull Planking', desc: 'Stronger planking shrugs off groundings and heavy seas.',
    levels: ['Pine planks', 'Oak planks', 'Copper sheathing', 'Ironwood ribs'], costs: [240, 640, 1500] },
  { id: 'hold', name: 'Cargo Hold', desc: 'More room below decks for trade goods.',
    levels: ['12 crates', '20 crates', '30 crates', '45 crates'], costs: [200, 560, 1300] },
  { id: 'spyglass', name: 'Spyglass', desc: 'See further. Reveals more of the chart and spots flotsam at range.',
    levels: ['Bare eyes', 'Brass glass', 'Navigator’s glass', 'Star-ground lens'], costs: [160, 480, 1100] },
];
export const HOLD_CAP = [12, 20, 30, 45];
export const HULL_MAX = [100, 130, 165, 210];
export const SIGHT = [520, 720, 950, 1250];

export const RANKS = [
  { at: 0, name: 'Deckhand' }, { at: 150, name: 'Able Sailor' }, { at: 450, name: 'Mariner' },
  { at: 900, name: 'Navigator' }, { at: 1600, name: 'Captain' }, { at: 2600, name: 'Master Mariner' }, { at: 3800, name: 'Legend of the Sea' },
];

export const BOTTLES = [
  { title: 'Log of the Marigold, I', text: 'Cast off from Port Haven with a fair wind and a foolish heart. They say there are five old fires out on the sea, cold for a hundred years. I mean to find them. — I. Maren' },
  { title: 'Log of the Marigold, II', text: 'The keeper at Gull Rock laughed at me, then gave me his chart. "The fires were never for ships," he said. "They were for the sea itself, so it would remember the way."' },
  { title: 'A child’s letter', text: 'Dear whoever finds this. My papa says the horizon is just a line and you can never get there. I think he is wrong. If you get there please write back.' },
  { title: 'Log of the Marigold, III', text: 'Found the first tower on a ring of coral. No door, no stair — only a bowl of black glass at the top. I slept beside it and dreamed of a light on the water.' },
  { title: 'Sailing master’s note', text: 'Remember, lad: you cannot sail into the wind’s eye. Fall off until the canvas fills, then ease her till she just stops shivering. The boat will tell you when she is happy.' },
  { title: 'Log of the Marigold, IV', text: 'Emberfall. The beacon stands where the lava once reached the sea. The stone is warm even at midnight. Something under the mountain is still listening.' },
  { title: 'Recipe, much stained', text: 'Kestrel’s Black Rum: molasses, rain water, patience. Sell it at the Reach where the nights are cold — they will pay double and thank you.' },
  { title: 'Log of the Marigold, V', text: 'Storm for three days. Reefed down to a scrap and still she flew. I have learned to love the sound of rain on the deck; it means I am still above it.' },
  { title: 'A merchant’s complaint', text: 'Spice from Saffron Cay is cheap as sand and Thornwall pays like kings for it. Silk the other way round. Why does nobody but me have a boat?' },
  { title: 'Log of the Marigold, VI', text: 'North of Frostspire the sea ends in a wall of cloud. The old people call it the Veil. I sailed at it for a day and woke up pointing home.' },
  { title: 'Unsigned verse', text: 'Five fires burning, the Veil will part. / Follow the north star, follow your heart. / What lies beyond, no chart can say — / only that the sea goes all the way.' },
  { title: 'Log of the Marigold, last page', text: 'Four fires lit. I am too old to light the fifth. Whoever reads this: the Marigold was a good boat and the horizon is not a line. Go and see. — Ilse Maren' },
];

export const RUMOURS = {
  haven: ['saffron', 'gull', 'coral'],
  saffron: ['whisper', 'bell', 'sisters'],
  thorn: ['tooth', 'ember', 'kestrel'],
  mistral: ['frost', 'coral', 'bell'],
  kestrel: ['lantern', 'thorn', 'frost'],
};

export const BEACON_LORE = {
  coral: 'The black glass drinks your lantern flame and gives back a column of pale gold. Far off, something answers.',
  ember: 'The fire takes at once, as if the mountain had been holding its breath. The sea around you glows like embers.',
  whisper: 'The pines fall silent. Then the beacon blooms, and every needle on the island turns to face it.',
  tooth: 'Light climbs the old fang of rock and leaps from its tip. Gulls wheel through it, shining.',
  frost: 'The flame burns blue-white against the snow. For a moment the northern cloud-wall flickers, as though it flinched.',
};

# Beyond the Horizon

An open-sea sailing adventure that runs entirely in the browser. Trim your sails to the wind, chart sixteen islands, trade between harbours, weather the storms, and light the five ancient beacons to open the way beyond the edge of the map.

**Play:** open `index.html` from any static web server (see below), or host the repository on GitHub Pages.

## Features

- **A living ocean** – Gerstner-wave water with matching CPU buoyancy, fresnel sky reflections, sun and moon glitter, subsurface glow in the crests, whitecaps that grow with the wind, shoreline surf, turquoise shallows and a persistent foam wake.
- **Real sailing** – apparent wind, lift/drag sail aerodynamics, a no-go zone, tacking and gybing, heel, leeway, weather helm, reefing, knock-downs and groundings. Trim by hand or switch on auto-trim.
- **Sixteen hand-placed, procedurally built islands** – sandy cays, an atoll, cliffs, sea stacks, a volcano and a snow-capped peak, with villages, piers, lighthouses, wrecks, palms and pines.
- **Dynamic sky and weather** – a full day/night cycle with stars, moon and aurora; clear skies, fresh breezes, fog, rain and thunderstorms with lightning.
- **Things to do** – a story quest across the whole sea, delivery contracts, a trading economy across five harbours, boat upgrades, shipwreck salvage, flotsam, messages in bottles and a fog-of-war sea chart.
- **Procedural sound** – sea, wind, rigging, rain, thunder, gulls, bells and a generative ambient score, all synthesised with the Web Audio API.
- **Persistent progress** – autosaves to the browser's local storage.

## Controls

| Key | Action |
| --- | --- |
| `A` `D` / `←` `→` | Rudder |
| `W` `S` / `↑` `↓` | Ease out / haul in the sheet |
| `E` `Q` | Raise / lower (reef) sail |
| `T` | Toggle auto-trim |
| `Space` | Drop / weigh anchor |
| `F` | Dock, light beacons, search wrecks |
| `M` · `J` | Sea chart · Journal |
| `C` | Chase / helm camera |
| Mouse drag · wheel | Look around · zoom |
| `Esc` | Pause |

Touch devices get on-screen controls.

## Running locally

There is no build step. Serve the folder with any static server, for example:

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>. (Opening `index.html` directly from disk will not work, because browsers block ES modules on `file://`.)

## Hosting on GitHub Pages

In the repository settings, open **Pages**, choose **Deploy from a branch**, and select the branch and `/ (root)`. Everything is static and all paths are relative. No API keys or external services are used.

## Project layout

```
index.html        markup for the canvas, HUD, menus and panels
css/style.css     interface styling
js/main.js        bootstrap, game loop, camera, input
js/ocean.js       wave model, ocean shader, CPU height sampler
js/sky.js         sky dome, sun/moon/stars/clouds, lighting
js/weather.js     weather states, wind, rain, lightning
js/world.js       islands, vegetation, harbours, landmarks
js/boat.js        boat model and sailing physics
js/effects.js     wake, spray, birds, dolphins, flotsam
js/audio.js       synthesised sound and music
js/game.js        save data, quests, trading, discovery
js/ui.js          HUD instruments, chart, harbour and journal screens
vendor/           three.js (MIT) and fonts (SIL OFL)
```

## Credits

Rendering uses [three.js](https://threejs.org) (MIT). Typefaces are Cinzel and Cormorant Garamond (SIL Open Font Licence). All models, textures, sound and music are generated procedurally at runtime.

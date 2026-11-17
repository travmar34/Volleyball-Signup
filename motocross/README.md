# Dirt Ridge MX

A physics-driven 3D motocross game that runs in the browser (no build step, no install).

Open `motocross/index.html` through any static web server (for example GitHub Pages, or `python3 -m http.server` inside this folder) and ride.

## Modes and tracks

| # | Track | Mode | Notes |
|---|-------|------|-------|
| 1 | Dusty Valley | Race vs 3 CPU riders | Hardpack, rollers, first doubles |
| 2 | Red Rock Quarry | Freestyle (120 s) | Steep kickers, score tricks |
| 3 | Pine Ridge Whoops | Race | Loam, long whoop sections, step-ups, a triple |
| 4 | Sunset Mesa | Freestyle (120 s) | Huge desert gaps for flips |
| 5 | Mudslide Hollow | Race | Rain, low-grip mud |
| 6 | Night Supercross | Race | Stadium, rhythm sections, fastest CPU riders |

A medal on a track unlocks the next one (Settings → "Unlock all tracks" skips this). Medals and best times are saved in the browser.

## Controls

* Throttle: Up / W (touch: GAS, gamepad: RT)
* Brake: Down / S (touch: BRAKE, gamepad: LT)
* Lean back / forward: Left / Right or A / D (in the air this rotates the bike)
* Tricks (hold in the air, release before landing): 1 Superman, 2 Heel Clicker, 3 Nac-Nac, 4 Can-Can, 5 Cliffhanger
* R: reset to the last safe spot. Esc / P: pause.

## What is simulated

* 2D rigid-body chassis with two sprung, damped wheels on a raked telescopic fork and a swingarm (sag, preload, separate compression and rebound damping, progressive bottoming).
* Tyres with load-dependent grip per surface (hardpack, loam, clay, sand, mud), wheelspin and rolling resistance.
* A 450cc single-cylinder engine with a torque curve, clutch slip, a 5-speed automatic gearbox, rev limiter, engine braking and an ECU wheelie/traction map.
* Brake and drive torques react on the chassis, so throttle in the air lifts the nose and the rear brake drops it, just like on a real bike.
* Rider weight shift, inverse-kinematics rider animation, trick poses and a ragdoll on crashes.
* CPU riders read the track ahead, compute launch speeds from projectile motion and control their pitch in the air to match the landing.
* Synthesised engine audio (Web Audio), roost and dust particles, rain, shadows and procedural terrain.

## Files

* `js/core.js`: maths, track builder, level definitions
* `js/physics.js`: bike, engine, rider and ragdoll physics
* `js/ai.js`: CPU riders
* `js/render.js`: three.js scene, models, particles, camera
* `js/audio.js`: engine and effects audio
* `js/game.js`: menus, input, rules, scoring, HUD
* `lib/three.min.js`: three.js r158 (MIT, see `lib/THREE_LICENSE`)

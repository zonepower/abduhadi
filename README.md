# GT Mini Tribute

This project is a lightweight homage to the Gran Turismo series that runs entirely in the browser. It is **not** Gran Turismo 7, but it now pushes the single-file demo with a more grounded driving model, richer materials, and trackside atmosphere including a banked oval circuit, timing HUD, checkpoints, and responsive controls. Everything is implemented with vanilla [Three.js](https://threejs.org/).

## Features

- Heavier-weight handling model with weight transfer, aerodynamic drag, wheel spin, realistic braking, and handbrake-induced slip
- Dynamic chase camera with speed-based FOV shifts, suspension bob, and steering sway
- Circular track with procedural asphalt, curbs, guardrails, floodlights, grandstands, and ambient mood lighting
- Detailed clear-coated car model with emissive lighting, glass, mirrors, and spinning rims
- Lap counter, live lap timer, personal best tracking, speedometer, gear indicator, and checkpoint callouts
- Off-track detection with automatic slowdown and visual warning banner
- Quick reset (`R`) to place the car back on the start/finish straight

## Running locally

Simply open `index.html` in a modern desktop browser (Chrome, Edge, Firefox, or Safari), then click **Start the Race** to drop into the track. No build step or server is required because all assets are generated procedurally.

### Controls

| Action        | Key(s)        |
| ------------- | ------------- |
| Accelerate    | `W` or `↑`     |
| Brake / Reverse | `S` or `↓` |
| Steer left    | `A` or `←`     |
| Steer right   | `D` or `→`     |
| Handbrake     | `Space`       |
| Reset car     | `R`           |

## Disclaimer

Gran Turismo 7 is an expansive commercial product with advanced physics, AI opponents, photo-realistic assets, online infrastructure, and licensed content. This mini project cannot replicate those systems. Instead, it demonstrates how far you can push a single HTML file to evoke the feel of taking a solo lap around a Gran Turismo-inspired circuit.

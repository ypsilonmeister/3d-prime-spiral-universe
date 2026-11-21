# AGENTS.md

This file provides guidance to AI coding agents (Claude Code, Codex, Gemini CLI / agy, etc.) when working in this repository.

## Project Overview

**3D Prime Spiral Universe** is an interactive WebGL visualization exploring the distribution of prime numbers within various 3D space-filling lattices. It is a collaborative creation between human and AI (Gemini & Claude), focusing on mathematical beauty and GPU-accelerated rendering.

- **Tech Stack:** Three.js, GLSL (Custom Shaders), Vanilla JavaScript (ES Modules), HTML5, CSS3.

## Development

ES Modules require a local HTTP server — opening `index.html` directly as a file will not work. Run any of the following in the project root:

```bash
# Python
python -m http.server

# Node.js
npx serve .
```

- **Build step:** None (no bundler/compilation). Changes are live on refresh.
- **Tests:** We use `pnpm` for dev dependencies (Playwright). Run tests with:

```bash
pnpm test
```

- **Deployment:** Automatic. Push to `master` → GitHub Actions (`.github/workflows/static.yml`) deploys to GitHub Pages.

## Development Conventions

- **Module system:** Native ES Modules. Dependencies (Three.js) are managed via an `importmap` in `index.html`.
- **UI interaction:** UI controls use `data-action` attributes in `index.html`, bound dynamically in `app/ui/bindings.js` to avoid exposing global functions on the `window` object.
- **Render loop:** Use `renderer.setAnimationLoop()` instead of `requestAnimationFrame` — required for WebXR compatibility.
- **Performance:** Most rendering logic (color, size, labels) is handled in custom GLSL shaders to manage 320,000+ points efficiently.
- **Math logic:** Mathematical constants and pure arithmetic functions reside in `shared/` (`shared/sieve.js`, `shared/arithmetic.js`, `shared/zeta-zeros.js`) — the source of truth — and are imported where needed (main application, worker, and sub-apps).
- **Styling:** Dark, futuristic "Cyber-Scientific" aesthetic. Shared styles are defined in `shared/theme.css`.

## Architecture

### Project structure

- `index.html` — Main entry point: UI layout and the Three.js import map.
- `style.css` — UI styling for the overlay and controls.
- `app/` — Application components:
  - `main.js` — Main entry script (composition root); boots the application and wires modules together.
  - `state.js` — Global state subscription repository.
  - `worker-client.js` — Integrates background worker computations.
  - `modes/` — Custom plugins implementing mode-specific logic (e.g. zeta, p-adic, Prime Dimension, NTL).
  - `render/` — Three.js visualization, lattice coordinates, and animation loop.
  - `ui/` — DOM interactions and UI rendering.
- `shared/` — Deduplicated math libraries (sieve, arithmetic, zeta zeros) and CSS (`theme.css`) shared across the main app and sub-apps.
- `worker.js` — Web worker / compute host running sieve and NTL calculations in a separate thread.
- `warpednt/`, `gaussianprimes/`, `primemusic/` — Independent sub-apps.
- `.github/workflows/static.yml` — Automated deployment to GitHub Pages.

### Rendering pipeline (`app/render/`)

- Three.js `Points` with a custom `ShaderMaterial` renders all 320,000 particles in a single draw call.
- `renderer.setAnimationLoop()` is used instead of `requestAnimationFrame` (WebXR compatibility, see Conventions).
- Non-VR stereo (Parallel / Cross) is done manually with scissor/viewport splitting per frame.
- WebXR immersive-vr: `renderer.xr.enabled = true`; calling `enterVR()` requests an `immersive-vr` session and Three.js handles stereo automatically. The "Enter VR" button is only shown when `navigator.xr.isSessionSupported('immersive-vr')` resolves true.

### Data flow

1. `generatePrimes(MAX_POINTS)` — Sieve of Eratosthenes into `isPrimeArray` (Uint8Array) and `primeGaps` (gap to next prime, capped at 255).
2. `calculateTargetPositions()` — builds a candidate list of 3D lattice points, sorts them by the chosen fill mode, then writes world-space coordinates into `targetPositions` (Float32Array, shared buffer).
3. Each frame in `animate()`, particle positions lerp toward `targetPositions` (`lerpSpeed = 0.05`).
4. `updateParticleVisuals()` — writes `customColor` and `size` attributes based on primality and the current color mode. Size `0.0` hides a particle; size `≥50` marks it as prime (used in the fragment shader for label rendering).

### Shader details

- Vertex: `gl_PointSize = size * (1500.0 / distance)` — perspective-correct point sizing.
- Fragment: Two textures — `starTex` (radial glow, 64×64 canvas) and `atlas` (digit strip, 1024×128 canvas with digits 0–9). Labels fade in via `smoothstep(2500, 800, distance)` and are only drawn when computed point size > 6px.

### Three.js version

CDN import via importmap, currently pinned to `0.167.0`. Changing the version requires updating both `"three"` and `"three/addons/"` entries in the importmap in `index.html`.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development

ES Modules require a local HTTP server — opening index.html directly as a file will not work.

```bash
# Python
python -m http.server

# Node.js
npx serve .
```

No build step, no package manager, no tests. Changes to `main.js` or `index.html` are live on refresh.

Deployment is automatic: push to `master` → GitHub Actions deploys to GitHub Pages.

## Architecture

The entire app is three files: `index.html`, `main.js`, `style.css`.

**Rendering pipeline** (`main.js`)

- Three.js `Points` with a custom `ShaderMaterial` renders all 320,000 particles in a single draw call.
- `renderer.setAnimationLoop()` is used instead of `requestAnimationFrame` — required for WebXR compatibility.
- Non-VR stereo (Parallel / Cross) is done manually with scissor/viewport splitting per frame.
- WebXR immersive-vr: `renderer.xr.enabled = true`; calling `enterVR()` requests an `immersive-vr` session and Three.js handles stereo automatically. The "Enter VR" button is only shown when `navigator.xr.isSessionSupported('immersive-vr')` resolves true.

**Data flow**

1. `generatePrimes(MAX_POINTS)` — Sieve of Eratosthenes into `isPrimeArray` (Uint8Array) and `primeGaps` (gap to next prime, capped at 255).
2. `calculateTargetPositions()` — builds a candidate list of 3D lattice points, sorts them by the chosen fill mode, then writes world-space coordinates into `targetPositions` (Float32Array, shared buffer).
3. Each frame in `animate()`, particle positions lerp toward `targetPositions` (`lerpSpeed = 0.05`).
4. `updateParticleVisuals()` — writes `customColor` and `size` attributes based on primality and the current color mode. Size `0.0` hides a particle; size `≥50` marks it as prime (used in the fragment shader for label rendering).

**Shader details**

- Vertex: `gl_PointSize = size * (1500.0 / distance)` — perspective-correct point sizing.
- Fragment: Two textures — `starTex` (radial glow, 64×64 canvas) and `atlas` (digit strip, 1024×128 canvas with digits 0–9). Labels fade in via `smoothstep(2500, 800, distance)` and are only drawn when computed point size > 6px.

**Three.js version**

CDN import via importmap, currently pinned to `0.167.0`. Changing the version requires updating both `"three"` and `"three/addons/"` entries in the importmap in `index.html`.

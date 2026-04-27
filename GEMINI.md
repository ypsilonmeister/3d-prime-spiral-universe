# GEMINI.md

This file provides context and instructions for Gemini CLI when working in the **3D Prime Spiral Universe** repository.

## Project Overview

**3D Prime Spiral Universe** is an interactive WebGL visualization exploring the distribution of prime numbers within various 3D space-filling lattices. It is a collaborative creation between human and AI (Gemini & Claude), focusing on mathematical beauty and GPU-accelerated rendering.

- **Tech Stack:** Three.js, GLSL (Custom Shaders), Vanilla JavaScript (ES Modules), HTML5, CSS3.
- **Key Files:**
  - `index.html`: Main entry point, UI layout, and Three.js import map.
  - `main.js`: Core logic, including Sieve of Eratosthenes, lattice generation, and the Three.js rendering loop.
  - `style.css`: UI styling for the overlay and controls.
  - `CLAUDE.md`: Implementation details and architectural notes (e.g., shader logic, WebXR support).

## Building and Running

The project uses ES Modules and requires a local HTTP server to run (direct file opening via `file://` will fail due to CORS).

### Development Server
Run any of the following in the project root:

```bash
# Python 3
python -m http.server

# Node.js
npx serve .
```

- **Build Step:** None. Changes are live on refresh.
- **Tests:** None.

## Development Conventions

- **Module System:** Uses native ES Modules. Dependencies (Three.js) are managed via an `importmap` in `index.html`. Do NOT use `npm install` unless introducing a build tool.
- **UI Interaction:** Buttons and selects in `index.html` call global functions explicitly attached to the `window` object in `main.js` (e.g., `window.setLayout`).
- **Rendering:** Uses `renderer.setAnimationLoop()` instead of `requestAnimationFrame` for WebXR compatibility.
- **Performance:** Most rendering logic (color, size, labels) is handled in custom GLSL shaders to manage 320,000+ points efficiently.
- **Math Logic:**
  - `generatePrimes()`: Uses Sieve of Eratosthenes.
  - `calculateTargetPositions()`: Generates 3D lattice points and sorts them according to the selected "Fill Mode".
- **Styling:** Adheres to a dark, futuristic "Cyber-Scientific" aesthetic using fonts like `Orbitron` and `Share Tech Mono`.

## Project Structure

- `.github/workflows/static.yml`: Automated deployment to GitHub Pages on push to `master`.
- `main.js`:
  - `init()`: Scene setup and event listeners.
  - `animate()`: Main loop handling lerping, controls, and stereo rendering.
  - `updateParticleVisuals()`: Updates GPU attributes for colors and sizes.
  - `generatePrimes()`: Mathematical foundation.

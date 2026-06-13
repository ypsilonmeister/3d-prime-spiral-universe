# GEMINI.md

This file provides context and instructions for Gemini CLI when working in the **3D Prime Spiral Universe** repository.

## Project Overview

**3D Prime Spiral Universe** is an interactive WebGL visualization exploring the distribution of prime numbers within various 3D space-filling lattices. It is a collaborative creation between human and AI (Gemini & Claude), focusing on mathematical beauty and GPU-accelerated rendering.

- **Tech Stack:** Three.js, GLSL (Custom Shaders), Vanilla JavaScript (ES Modules), HTML5, CSS3.
- **Key Files:**
  - `index.html`: Main entry point, UI layout, and Three.js import map.
  - `app/main.js`: Main entry script (composition root) loading other modular files.
  - `style.css`: UI styling for the overlay and controls.
  - `shared/`: Mathematical core functions (sieve, arithmetic, zeta zeros) and style shared across apps.
  - `worker.js`: Web worker for background number-theoretic computations.
  - `CLAUDE.md`: Implementation details and architectural notes.

## Building and Running

The project uses ES Modules and requires a local HTTP server to run.

### Development Server
Run any of the following in the project root:

```bash
# Python 3
python -m http.server

# Node.js
npx serve .
```

- **Build Step:** None. Changes are live on refresh.
- **Tests:** Run Playwright tests with `pnpm test`.

## Development Conventions

- **Module System:** Uses native ES Modules. Dependencies (Three.js) are managed via an `importmap` in `index.html`.
- **UI Interaction:** UI controls use `data-action` attributes in `index.html`, bound dynamically in `app/ui/bindings.js` to avoid exposing global functions on the `window` object.
- **Rendering:** Uses `renderer.setAnimationLoop()` instead of `requestAnimationFrame` for WebXR compatibility.
- **Performance:** Most rendering logic (color, size, labels) is handled in custom GLSL shaders to manage 320,000+ points efficiently.
- **Math Logic:**
  - Mathematical constants and pure arithmetic functions reside in `shared/` (`shared/sieve.js`, `shared/arithmetic.js`, `shared/zeta-zeros.js`) and are imported where needed (in main application, worker, and sub-apps).
- **Styling:** Adheres to a dark, futuristic "Cyber-Scientific" aesthetic. Shared styles are defined in `shared/theme.css`.

## Project Structure

- `.github/workflows/static.yml`: Automated deployment to GitHub Pages.
- `app/`:
  - `main.js`: Boots the application and wires modules together.
  - `state.js`: Global state subscription repository.
  - `worker-client.js`: Integrates background worker computations.
  - `modes/`: Custom plugins implementing mode-specific logic (e.g. zeta, p-adic, Prime Dimension, NTL).
  - `render/`: Handles Three.js visualization, lattice coordinates, and animation loop.
  - `ui/`: Controls DOM interactions and UI renders.
- `shared/`: Deduplicated math libraries and CSS stylesheet.
- `worker.js`: Compute host running sieve and NTL calculations in a separate thread.

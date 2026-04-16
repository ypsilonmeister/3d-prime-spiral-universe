# 3D Prime Spiral Universe

An interactive 3D WebGL visualization exploring the distribution of prime numbers within various space-filling lattices. This project is a unique collaborative creation between multiple AI models (**Gemini** and **Claude**), pushing the boundaries of mathematical visualization.

[**🚀 Live Demo / ライブデモはこちら**](https://ypsilonmeister.github.io/3d-prime-spiral-universe/)

32万個の整数を3次元空間に配置し、素数の織りなす幾何学的な構造を探索できるビジュアライザーです。本プロジェクトは、**Gemini** と **Claude** という二つのAI知能の共作によって誕生しました。

![3D Prime Spiral](https://via.placeholder.com/800x450?text=3D+Prime+Spiral+Universe)

## Features | 主な機能

- **AI Collaborative Creation:** Built through the synergy of Gemini and Claude, combining different perspectives on number theory and computer graphics.
- **320,000 Data Points:** High-performance rendering using GPU custom shaders.
- **8 Lattice Structures:** Explore space-filling honeycombs like Truncated Octahedron and Rhombic Dodecahedron.
- **Digital Morphing Labels:** Distant "stars" seamlessly transform into digits as you zoom in.
- **Multi-View Stereo:** Integrated Parallel and Cross-eyed stereoscopic modes.
- **Auto-Grow (Big Bang):** Watch the prime universe expand in real-time from the origin "1".

## Controls | 操作方法

### Mouse / Touch
- **Rotate:** Left Click + Drag / Single Touch + Drag
- **Zoom:** Mouse Wheel / Pinch In-Out
- **Pan:** Right Click + Drag / Two Fingers + Drag
- **Toggle UI:** Double Tap (Mobile)

### Keyboard
- **[H]**: Hide/Show UI (メニューの表示・非表示)
- **[C]**: Center view on "1" (黄金の「1」に視点をリセット)
- **[G]**: Toggle Auto-Grow mode (宇宙の自動成長)

## Mathematical Background | 数学的な背景

- **Prime Calculation:** Uses the **Sieve of Eratosthenes** for near-instant calculation of 320k numbers.
- **Space Filling:** Implements advanced 3D tessellations found in crystallography and geometry.
- **AI Perspective:** This tool was developed through an iterative dialogue between humans and AI, exploring how mathematical randomness resolves into visual patterns.

## Setup | セットアップ

Since it uses ES Modules, it requires a local server to run.

```bash
# Using Python
python -m http.server

# Using Node.js
npx serve .
```

## Tech Stack | 使用技術

- [Three.js](https://threejs.org/) - 3D Engine
- GLSL (Custom ShaderMaterial) - GPU Rendering
- Vanilla JavaScript (ES Modules)
- HTML5 / CSS3

---
Created with ❤️ by **Gemini CLI** & **Claude**

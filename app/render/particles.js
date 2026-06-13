// Particles rendering, shader material, Nixie tube atlas and glow texture

import * as THREE from 'three';
import { state } from '../state.js';

export const NUMBER_TYPES = [
    // n=1 special
    { key: 'one',       label: '1 (Unity)',           color: '#ffd700', size: 120, defaultOn: true,
      test: n => n === 1 },

    // --- Prime subtypes (checked in priority order) ---
    { key: 'mersenne',  label: 'Mersenne',            color: '#ff4dff', size: 100, defaultOn: true,
      test: n => [3,7,31,127,8191,131071].includes(n) },

    { key: 'fermat',    label: 'Fermat',              color: '#ff9900', size: 100, defaultOn: true,
      test: n => [3,5,17,257,65537].includes(n) },

    { key: 'twin',      label: 'Twin (p±2)',          color: '#00ffcc', size: 85, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 && (ip[n-2] || (n+2 <= state.MAX_POINTS && ip[n+2])) },

    { key: 'cousin',    label: 'Cousin (p±4)',        color: '#33ccff', size: 82, defaultOn: true,
      test: (n, ip) => ip[n] && n > 4 && (ip[n-4] || (n+4 <= state.MAX_POINTS && ip[n+4])) },

    { key: 'sexy',      label: 'Sexy (p±6)',          color: '#66aaff', size: 80, defaultOn: true,
      test: (n, ip) => ip[n] && n > 6 && (ip[n-6] || (n+6 <= state.MAX_POINTS && ip[n+6])) },

    { key: 'safe',      label: 'Safe ((p-1)/2 prime)',color: '#ff6680', size: 82, defaultOn: true,
      test: (n, ip) => ip[n] && n > 5 && (n-1)%2===0 && ip[(n-1)/2] },

    { key: 'sophie',    label: 'Sophie Germain',      color: '#ff99cc', size: 82, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 && (2*n+1 <= state.MAX_POINTS) && ip[2*n+1] },

    { key: 'palindrome',label: 'Palindrome prime',    color: '#aaff44', size: 85, defaultOn: true,
      test: (n, ip) => {
          if (!ip[n]) return false;
          const s = String(n); return s === s.split('').reverse().join('');
      }},

    { key: 'repunit',   label: 'Repunit (11, R19…)',  color: '#ffdd00', size: 90, defaultOn: true,
      test: (n, ip) => ip[n] && /^1+$/.test(String(n)) },

    { key: 'prime',     label: 'Other prime',         color: '#4d94ff', size: 80, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 },

    { key: 'two',       label: '2 (even prime)',      color: '#00ffff', size: 85, defaultOn: true,
      test: n => n === 2 },

    // --- Composite categories ---
    { key: 'perfect',   label: 'Perfect (6,28,496…)', color: '#ffffff', size: 60, defaultOn: true,
      test: n => [6,28,496,8128].includes(n) },

    { key: 'primepow',  label: 'Prime power (p^k)',   color: '#cc44ff', size: 50, defaultOn: true,
      test: (n, ip) => {
          if (ip[n] || n < 4) return false;
          for (let p = 2; p * p <= n; p++) {
              if (n % p === 0) {
                  let m = n;
                  while (m % p === 0) m = m / p;
                  if (m === 1) return ip[p] === 1;
              }
          }
          return false;
      }},

    { key: 'even',      label: 'Even composite',      color: '#1a4d6b', size: 28, defaultOn: true,
      test: (n, ip) => !ip[n] && n > 2 && n % 2 === 0 },

    { key: 'odd',       label: 'Odd composite',       color: '#3a3a5c', size: 28, defaultOn: true,
      test: (n, ip) => !ip[n] && n > 1 && n % 2 !== 0 },
];

export const typeMap = {};
for (const t of NUMBER_TYPES) {
    typeMap[t.key] = t;
}

export function classifyNumbers() {
    for (let n = 1; n <= state.MAX_POINTS; n++) {
        let matched = null;
        for (const t of NUMBER_TYPES) {
            if (t.test(n, state.isPrimeArray)) { matched = t; break; }
        }
        if (!matched) matched = typeMap['odd'];
        state.numberType[n] = matched.key;
        state.particleTypeDef[n] = matched;
    }
    // Initialize typeVisibility if empty
    if (Object.keys(state.typeVisibility).length === 0) {
        for (const t of NUMBER_TYPES) {
            state.typeVisibility[t.key] = t.defaultOn;
        }
    }
}

export function isCompositeVisible(n) {
    const isComp = !state.isPrimeArray[n] && n > 1;
    if (!isComp) return true;
    if (state.compositeMode === 'none') return false;
    if (state.compositeMode === 'odd') return n % 2 !== 0;
    if (state.compositeMode === 'even') return n % 2 === 0;
    return true;
}

export function clearAboveActive() {
    if (!state.geometry) return;
    if (state._maxRenderedCount <= state.activePointCount) {
        state._maxRenderedCount = state.activePointCount;
        return;
    }
    const sizes = state.geometry.attributes.size.array;
    for (let i = state.activePointCount; i < state._maxRenderedCount; i++) {
        sizes[i] = 0.0;
    }
    state._maxRenderedCount = state.activePointCount;
}

export function updateParticleVisuals() {
    // Sieve, NTL, Padic, PrimeDim modes override particle visuals.
    // If none are active, we render standard layouts.
    if (state.sieveModeActive) {
        // Controlled by sieve-anim mode plugin
        return;
    }
    if (state.ntlModeActive) {
        // Controlled by ntl mode plugin
        return;
    }
    if (state.primeDimModeActive) {
        // Controlled by prime-dim mode plugin
        return;
    }
    if (state.padicModeActive && state.padicColorMode) {
        // Controlled by padic mode plugin
        return;
    }

    const cols = state.geometry.attributes.customColor.array;
    const sizes = state.geometry.attributes.size.array;
    const color = new THREE.Color();

    const typeRGB = {};
    for (const t of NUMBER_TYPES) {
        color.set(t.color);
        typeRGB[t.key] = [color.r, color.g, color.b];
    }

    const isTypes = state.colorMode === 'types';
    const isDepth = state.colorMode === 'depth';

    let maxDepth = 1;
    if (isDepth) {
        for (let i = 0; i < state.activePointCount; i++) {
            const d2 = state.targetPositions[i*3]**2 + state.targetPositions[i*3+1]**2 + state.targetPositions[i*3+2]**2;
            if (d2 > maxDepth) maxDepth = d2;
        }
        maxDepth = Math.sqrt(maxDepth);
    }

    for (let n = 1; n <= state.activePointCount; n++) {
        const i = n - 1;

        if (!isCompositeVisible(n)) { sizes[i] = 0.0; continue; }

        const tkey = state.numberType[n];

        if (isTypes) {
            if (!state.typeVisibility[tkey]) { sizes[i] = 0.0; continue; }
            const rgb = typeRGB[tkey];
            const tdef = state.particleTypeDef[n];
            cols[i*3] = rgb[0]; cols[i*3+1] = rgb[1]; cols[i*3+2] = rgb[2];
            sizes[i] = tdef.size;
        } else {
            if (n === 1) {
                color.set(0xffd700); sizes[i] = 120.0;
            } else if (state.isPrimeArray[n]) {
                sizes[i] = 80.0;
                if      (state.colorMode === 'spectrum') { color.setHSL(0.55 + (n/state.MAX_POINTS)*0.3, 1.0, 0.6); }
                else if (state.colorMode === 'mod6') {
                    if      (n === 2) color.setHSL(0.08, 1.0, 0.65);
                    else if (n === 3) color.setHSL(0.33, 1.0, 0.65);
                    else if (n % 6 === 1) color.setHSL(0.57, 1.0, 0.60);
                    else                  color.setHSL(0.85, 1.0, 0.60);
                }
                else if (state.colorMode === 'mod10') { color.setHSL((n % 10) / 10.0, 0.9, 0.6); }
                else if (state.colorMode === 'twin') {
                    const tw = n > 2 && (state.isPrimeArray[n-2] || (n+2 <= state.MAX_POINTS && state.isPrimeArray[n+2]));
                    color.setHSL(tw ? 0.12 : 0.62, 1.0, tw ? 0.72 : 0.55);
                }
                else if (state.colorMode === 'gap') {
                    const g = state.primeGaps[n] || 2;
                    color.setHSL((1.0 - Math.min(g, 72) / 72) * 0.65, 1.0, 0.6);
                }
                else if (isDepth) {
                    const dx=state.targetPositions[i*3], dy=state.targetPositions[i*3+1], dz=state.targetPositions[i*3+2];
                    color.setHSL(0.55 + (Math.sqrt(dx*dx+dy*dy+dz*dz) / maxDepth) * 0.45, 1.0, 0.6);
                }
            } else {
                color.set(0x3a3a5c);
                sizes[i] = 28.0;
            }
            cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
        }
    }
    clearAboveActive();
    state.geometry.attributes.customColor.needsUpdate = true;
    state.geometry.attributes.size.needsUpdate = true;
}

export function createParticles() {
    state.geometry = new THREE.BufferGeometry();
    const pos = new Float32Array(state.MAX_POINTS * 3);
    const nums = new Float32Array(state.MAX_POINTS);
    for (let n = 1; n <= state.MAX_POINTS; n++) {
        nums[n-1] = n;
        pos[(n-1)*3]   = (Math.random()-0.5)*5000;
        pos[(n-1)*3+1] = (Math.random()-0.5)*5000;
        pos[(n-1)*3+2] = (Math.random()-0.5)*5000;
    }
    state.geometry.setAttribute('position',    new THREE.BufferAttribute(pos, 3));
    state.geometry.setAttribute('number',      new THREE.BufferAttribute(nums, 1));
    state.geometry.setAttribute('customColor', new THREE.BufferAttribute(new Float32Array(state.MAX_POINTS*3), 3));
    state.geometry.setAttribute('size',        new THREE.BufferAttribute(new Float32Array(state.MAX_POINTS), 1));
    
    updateParticleVisuals();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            atlas:       { value: createNumberAtlas() },
            starTex:     { value: createGlowTexture() },
            uShowLabels: { value: 1.0 },
            uViewHeight: { value: window.innerHeight }
        },
        vertexShader: `
            attribute float size; attribute float number; attribute vec3 customColor;
            uniform float uViewHeight;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                vColor = customColor; vNumber = number; vSize = size;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vDistance = -mvPosition.z;
                gl_PointSize = max(size * (uViewHeight * 1.5 / vDistance), 0.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform sampler2D atlas; uniform sampler2D starTex; uniform float uShowLabels; uniform float uViewHeight;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                float n = floor(vNumber + 0.5);
                if (n < 0.5 || vSize < 0.1) discard;
                float currentPointSize = max(vSize * (uViewHeight * 1.5 / vDistance), 0.0);
                float isPrime = step(50.0, vSize);
                float labelFar  = uViewHeight * 3.5;
                float labelNear = uViewHeight * 1.1;
                float numMix = uShowLabels * isPrime * smoothstep(labelFar, labelNear, vDistance);
                vec4 starColor = vec4(vColor * 1.5, 1.0) * texture2D(starTex, gl_PointCoord);
                if (numMix > 0.01 && currentPointSize > 6.0) {
                    float numDigits = 1.0;
                    if (n >= 9.5)   numDigits = 2.0;
                    if (n >= 99.5)  numDigits = 3.0;
                    if (n >= 999.5) numDigits = 4.0;
                    if (n >= 9999.5)numDigits = 5.0;
                    if (n >= 99999.5)numDigits = 6.0;
                    float mX = 0.10; float mY = 0.175;
                    vec2 pc = (gl_PointCoord - vec2(mX, mY)) / vec2(1.0 - 2.0*mX, 1.0 - 2.0*mY);
                    if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) {
                        gl_FragColor = starColor;
                    } else {
                        float digitIndex = floor(pc.x * numDigits + 0.001);
                        float localX = fract(pc.x * numDigits + 0.001);
                        float power = pow(10.0, numDigits - 1.0 - digitIndex);
                        float digit = mod(floor(n / power), 10.0);
                        vec2 numUV = vec2((digit + localX) / 10.0, 1.0 - pc.y);
                        vec4 numTex = texture2D(atlas, numUV);
                        gl_FragColor = mix(starColor, vec4(vColor * 2.5, numTex.a), numMix);
                    }
                } else {
                    gl_FragColor = starColor;
                }
                if (gl_FragColor.a < 0.01) discard;
            }
        `,
        blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, depthTest: true
    });
    
    state.points = new THREE.Points(state.geometry, material);
    state.scene.add(state.points);
}

export function createNumberAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const slotW = 102.4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < 10; i++) {
        const cx = i * slotW + slotW * 0.5;
        const cy = 64;

        // outermost diffuse halo
        ctx.font = '108px "Nixie One", serif';
        ctx.shadowColor = 'rgba(255, 120, 20, 0.25)';
        ctx.shadowBlur = 40;
        ctx.fillStyle = 'rgba(255, 100, 10, 0.18)';
        ctx.fillText(i.toString(), cx, cy);

        // mid glow
        ctx.shadowColor = 'rgba(255, 160, 40, 0.6)';
        ctx.shadowBlur = 18;
        ctx.fillStyle = 'rgba(255, 140, 30, 0.55)';
        ctx.fillText(i.toString(), cx, cy);

        // tight inner glow
        ctx.shadowColor = 'rgba(255, 200, 80, 0.9)';
        ctx.shadowBlur = 6;
        ctx.fillStyle = '#ff9922';
        ctx.fillText(i.toString(), cx, cy);

        // bright hot core
        ctx.shadowColor = 'rgba(255, 240, 160, 1.0)';
        ctx.shadowBlur = 2;
        ctx.fillStyle = '#ffe0a0';
        ctx.fillText(i.toString(), cx, cy);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
}

export function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32,32,0,32,32,32);
    grad.addColorStop(0,'white');
    grad.addColorStop(0.2,'rgba(255,255,255,0.8)');
    grad.addColorStop(0.5,'rgba(255,255,255,0.3)');
    grad.addColorStop(1,'transparent');
    ctx.fillStyle = grad; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
}

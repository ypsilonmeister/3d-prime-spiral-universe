import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- Configuration ---
const MAX_POINTS = 320000;
let activePointCount = 320000;
let currentLayout = 'cube';
let currentFillMode = 'shell';
let currentSpacing = 65;
let hideComposites = false;
let colorMode = 'types';
let stereoMode = 'off';
let uiVisible = true;
let showLabels = true;
let autoGrow = false;
let growSpeed = 50;
let linearStride = 0;
const targetPositions = new Float32Array(MAX_POINTS * 3);
const lerpSpeed = 0.05;

// --- State ---
let scene, camera, cameraL, cameraR, renderer, controls, points, geometry;
const isPrimeArray = new Uint8Array(MAX_POINTS + 1);
const primeGaps = new Uint8Array(MAX_POINTS + 2);
// numberType[n] = category key string (assigned in classifyNumbers)
const numberType = new Array(MAX_POINTS + 1);
let lastTapTime = 0;

// --- WebXR ---
let vrSession = null;
let vrSupported = false;

// ---------------------------------------------------------------------------
// Number type definitions
// order matters: first match wins (prime subtypes checked before generic prime)
// ---------------------------------------------------------------------------
const NUMBER_TYPES = [
    // n=1 special
    { key: 'one',       label: '1 (Unity)',           color: '#ffd700', size: 120, defaultOn: true,
      test: n => n === 1 },

    // --- Prime subtypes (checked in priority order) ---
    { key: 'mersenne',  label: 'Mersenne',            color: '#ff4dff', size: 100, defaultOn: true,
      // 2^p-1 that are prime, within range: 3,7,31,127,8191,131071
      test: n => [3,7,31,127,8191,131071].includes(n) },

    { key: 'fermat',    label: 'Fermat',              color: '#ff9900', size: 100, defaultOn: true,
      // 2^(2^n)+1: 3,5,17,257,65537
      test: n => [3,5,17,257,65537].includes(n) },

    { key: 'twin',      label: 'Twin (p±2)',          color: '#00ffcc', size: 85, defaultOn: true,
      test: (n, ip) => ip[n] && n > 2 && (ip[n-2] || (n+2 <= MAX_POINTS && ip[n+2])) },

    { key: 'cousin',    label: 'Cousin (p±4)',        color: '#33ccff', size: 82, defaultOn: true,
      test: (n, ip) => ip[n] && n > 4 && (ip[n-4] || (n+4 <= MAX_POINTS && ip[n+4])) },

    { key: 'sexy',      label: 'Sexy (p±6)',          color: '#66aaff', size: 80, defaultOn: true,
      test: (n, ip) => ip[n] && n > 6 && (ip[n-6] || (n+6 <= MAX_POINTS && ip[n+6])) },

    { key: 'safe',      label: 'Safe ((p-1)/2 prime)',color: '#ff6680', size: 82, defaultOn: true,
      // p is safe prime: p>5, p prime, (p-1)/2 prime
      test: (n, ip) => ip[n] && n > 5 && (n-1)%2===0 && ip[(n-1)/2] },

    { key: 'sophie',    label: 'Sophie Germain',      color: '#ff99cc', size: 82, defaultOn: true,
      // p prime, 2p+1 also prime (and 2p+1 <= MAX)
      test: (n, ip) => ip[n] && n > 2 && (2*n+1 <= MAX_POINTS) && ip[2*n+1] },

    { key: 'palindrome',label: 'Palindrome prime',    color: '#aaff44', size: 85, defaultOn: true,
      test: (n, ip) => {
          if (!ip[n]) return false;
          const s = String(n); return s === s.split('').reverse().join('');
      }},

    { key: 'repunit',   label: 'Repunit (11, R19…)',  color: '#ffdd00', size: 90, defaultOn: true,
      // Repunit primes within range: 11, R19=1111111111111111111 (>range), so just 11
      // Also R2=11, R19 is 19 digits so out of range
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
          // check if n = p^k for k>=2
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

// visibility state per key
const typeVisibility = {};
for (const t of NUMBER_TYPES) typeVisibility[t.key] = t.defaultOn;

// ---------------------------------------------------------------------------
// Classify every number once after sieve
// ---------------------------------------------------------------------------
function classifyNumbers() {
    for (let n = 1; n <= MAX_POINTS; n++) {
        for (const t of NUMBER_TYPES) {
            if (t.test(n, isPrimeArray)) { numberType[n] = t.key; break; }
        }
        if (!numberType[n]) numberType[n] = 'odd'; // fallback
    }
}

function init() {
    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 200000);
    camera.position.set(3000, 3000, 5000);

    cameraL = new THREE.PerspectiveCamera(60, (window.innerWidth/2) / window.innerHeight, 1, 200000);
    cameraR = new THREE.PerspectiveCamera(60, (window.innerWidth/2) / window.innerHeight, 1, 200000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x010103, 1);
    renderer.autoClear = false;
    renderer.xr.enabled = true;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.15;

    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then(supported => {
            vrSupported = supported;
            if (supported) document.getElementById('vr-btn').style.display = '';
        });
    }

    generatePrimes(MAX_POINTS);
    classifyNumbers();
    buildTypeUI();
    createParticles();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h') toggleUI();
        if (e.key.toLowerCase() === 'c') centerOne();
        if (e.key.toLowerCase() === 'g') toggleAutoGrow();
    });

    window.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 3) { toggleUI(); return; }
        if (e.touches.length > 1) return;
        const currentTime = new Date().getTime();
        if (currentTime - lastTapTime < 300) toggleUI();
        lastTapTime = currentTime;
    }, { passive: true });

    window.setLayout   = (l) => { currentLayout = l; calculateTargetPositions(); updateUI(); };
    window.setFillMode = (m) => { currentFillMode = m; calculateTargetPositions(); updateUI(); };
    window.toggleComposites = () => { hideComposites = !hideComposites; updateParticleVisuals(); updateUI(); };
    window.setColorMode = (mode) => { colorMode = mode; updateParticleVisuals(); updateUI(); };
    window.setStereoMode = (mode) => { stereoMode = mode; onWindowResize(); updateUI(); };
    window.toggleAutoGrow = () => { autoGrow = !autoGrow; if (autoGrow) growSpeed = 50; updateUI(); };
    window.toggleLabels = () => {
        showLabels = !showLabels;
        points.material.uniforms.uShowLabels.value = showLabels ? 1.0 : 0.0;
        updateUI();
    };
    window.toggleUI = () => {
        uiVisible = !uiVisible;
        document.getElementById('ui-overlay').classList.toggle('hidden', !uiVisible);
        document.getElementById('show-ui-hint').style.opacity = uiVisible ? '0' : '0.5';
    };
    window.centerOne = () => {
        const tx = targetPositions[0], ty = targetPositions[1], tz = targetPositions[2];
        controls.target.set(tx, ty, tz);
        camera.position.set(tx + 3000, ty + 3000, tz + 5000);
        controls.update();
    };
    window.enterVR = () => enterVR();
    window.toggleType = (key) => {
        typeVisibility[key] = !typeVisibility[key];
        updateParticleVisuals();
        updateTypeUI();
    };

    const sSlider = document.getElementById('spacing-slider');
    sSlider.addEventListener('input', (e) => {
        currentSpacing = parseInt(e.target.value);
        document.getElementById('spacing-val').innerText = currentSpacing;
        calculateTargetPositions();
    });

    const cSlider = document.getElementById('count-slider');
    cSlider.addEventListener('input', (e) => {
        activePointCount = parseInt(e.target.value);
        autoGrow = false;
        updateUI();
        updateParticleVisuals();
    });

    const strideSlider = document.getElementById('stride-slider');
    strideSlider.addEventListener('input', (e) => {
        linearStride = parseInt(e.target.value);
        document.getElementById('stride-val').innerText = linearStride <= 0 ? 'Auto' : linearStride;
        calculateTargetPositions();
    });

    calculateTargetPositions();
    updateUI();
    renderer.setAnimationLoop(animate);
}

// ---------------------------------------------------------------------------
// Build the Number Types panel in the UI
// ---------------------------------------------------------------------------
function buildTypeUI() {
    const container = document.getElementById('type-list');
    container.innerHTML = '';
    for (const t of NUMBER_TYPES) {
        const row = document.createElement('div');
        row.className = 'type-row';
        row.id = `type-row-${t.key}`;
        row.innerHTML = `
            <span class="type-dot" style="background:${t.color};box-shadow:0 0 5px ${t.color}"></span>
            <span class="type-label">${t.label}</span>
            <div class="toggle-switch ${t.defaultOn ? 'on' : ''}" id="sw-type-${t.key}"></div>
        `;
        row.addEventListener('click', () => window.toggleType(t.key));
        container.appendChild(row);
    }
}

function updateTypeUI() {
    for (const t of NUMBER_TYPES) {
        const sw = document.getElementById(`sw-type-${t.key}`);
        if (sw) sw.classList.toggle('on', !!typeVisibility[t.key]);
    }
}

// ---------------------------------------------------------------------------
// Sieve
// ---------------------------------------------------------------------------
function generatePrimes(n) {
    isPrimeArray.fill(1);
    isPrimeArray[0] = isPrimeArray[1] = 0;
    for (let i = 2; i * i <= n; i++)
        if (isPrimeArray[i]) for (let j = i * i; j <= n; j += i) isPrimeArray[j] = 0;
    let prev = 2;
    for (let i = 3; i <= n; i++)
        if (isPrimeArray[i]) { primeGaps[prev] = Math.min(i - prev, 255); prev = i; }
}

// ---------------------------------------------------------------------------
// updateUI
// ---------------------------------------------------------------------------
function updateUI() {
    document.getElementById('layout-select').value = currentLayout;
    document.getElementById('fillmode-select').value = currentFillMode;
    document.getElementById('count-val').innerText = activePointCount.toLocaleString();
    document.getElementById('count-slider').value = activePointCount;
    document.getElementById('range-info').innerText = `1 - ${activePointCount.toLocaleString()}`;
    const st = document.getElementById('current-state-text');
    if (st) st.innerText = `${currentLayout.toUpperCase()} - ${currentFillMode.toUpperCase()}`;
    document.getElementById('sw-composites').classList.toggle('on', !hideComposites);
    document.getElementById('sw-labels').classList.toggle('on', showLabels);
    document.getElementById('sw-autogrow').classList.toggle('on', autoGrow);
    document.getElementById('color-select').value = colorMode;
    document.getElementById('stereo-select').value = stereoMode;
    const strideSection = document.getElementById('stride-section');
    if (strideSection) strideSection.style.display = (currentFillMode === 'linear') ? '' : 'none';
    document.getElementById('stride-val').innerText = linearStride <= 0 ? 'Auto' : linearStride;
    document.getElementById('stride-slider').value = linearStride;

    const typePanel = document.getElementById('type-panel');
    if (typePanel) typePanel.style.display = (colorMode === 'types') ? '' : 'none';

    updateTypeUI();
}

// ---------------------------------------------------------------------------
// Particle visuals
// ---------------------------------------------------------------------------
function updateParticleVisuals() {
    const cols = geometry.attributes.customColor.array;
    const sizes = geometry.attributes.size.array;
    const color = new THREE.Color();

    let maxDepth = 1;
    if (colorMode === 'depth') {
        for (let i = 0; i < activePointCount; i++) {
            const d = Math.sqrt(targetPositions[i*3]**2 + targetPositions[i*3+1]**2 + targetPositions[i*3+2]**2);
            if (d > maxDepth) maxDepth = d;
        }
    }

    // pre-build a lookup from key -> type def
    const typeMap = {};
    for (const t of NUMBER_TYPES) typeMap[t.key] = t;

    for (let n = 1; n <= MAX_POINTS; n++) {
        const i = n - 1;
        if (n > activePointCount) { sizes[i] = 0.0; continue; }

        const tkey = numberType[n];
        const tdef = typeMap[tkey];
        const visible = typeVisibility[tkey];

        if (colorMode === 'types') {
            if (!visible) { sizes[i] = 0.0; continue; }
            // composites: respect hideComposites toggle
            const isComposite = !isPrimeArray[n] && n > 1;
            if (isComposite && hideComposites) { sizes[i] = 0.0; continue; }
            color.set(tdef.color);
            sizes[i] = tdef.size;
        } else {
            const isComposite = !isPrimeArray[n] && n > 1;
            if (isComposite && hideComposites) { sizes[i] = 0.0; continue; }

            if (n === 1) {
                color.set(0xffd700); sizes[i] = 120.0;
            } else if (isPrimeArray[n]) {
                sizes[i] = 80.0;
                if (colorMode === 'spectrum') { color.setHSL(0.55 + (n/MAX_POINTS)*0.3, 1.0, 0.6); }
                else if (colorMode === 'mod6') {
                    if      (n === 2) color.setHSL(0.08, 1.0, 0.65);
                    else if (n === 3) color.setHSL(0.33, 1.0, 0.65);
                    else if (n % 6 === 1) color.setHSL(0.57, 1.0, 0.60);
                    else               color.setHSL(0.85, 1.0, 0.60);
                }
                else if (colorMode === 'mod10') { color.setHSL((n % 10) / 10.0, 0.9, 0.6); }
                else if (colorMode === 'twin') {
                    const tw = n > 2 && (isPrimeArray[n-2] || (n+2 <= MAX_POINTS && isPrimeArray[n+2]));
                    color.setHSL(tw ? 0.12 : 0.62, 1.0, tw ? 0.72 : 0.55);
                }
                else if (colorMode === 'gap') {
                    const g = primeGaps[n] || 2;
                    color.setHSL((1.0 - Math.min(g, 72) / 72) * 0.65, 1.0, 0.6);
                }
                else if (colorMode === 'depth') {
                    const dx=targetPositions[i*3], dy=targetPositions[i*3+1], dz=targetPositions[i*3+2];
                    color.setHSL(0.55 + (Math.sqrt(dx*dx+dy*dy+dz*dz) / maxDepth) * 0.45, 1.0, 0.6);
                }
            } else {
                color.set(0x3a3a5c);
                sizes[i] = 28.0;
            }
        }

        cols[i*3] = color.r; cols[i*3+1] = color.g; cols[i*3+2] = color.b;
    }
    geometry.attributes.customColor.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Target positions
// ---------------------------------------------------------------------------
function calculateTargetPositions() {
    let candidates = [];
    let range = 45;
    if (currentLayout === 'tetra' || currentLayout === 'rhombic') range = 58;
    if (currentLayout === 'triangular') range = 62;
    if (currentLayout === 'omnitruncated') range = 36;
    if (currentLayout === 'gyroid') range = 55;

    if (currentLayout === 'cube') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x,y,z});
    } else if (currentLayout === 'hexagonal' || currentLayout === 'triangular') {
        const s3=Math.sqrt(3);
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) candidates.push({x:x+(Math.abs(y)%2)*0.5,y:y*(s3/2),z});
    } else if (currentLayout === 'octahedral' || currentLayout === 'bitruncated') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
    } else if (currentLayout === 'tetra' || currentLayout === 'rhombic') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) if(Math.abs(x+y+z)%2===0) candidates.push({x,y,z});
    } else if (currentLayout === 'omnitruncated') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) { candidates.push({x:x*2,y:y*2,z:z*2}); candidates.push({x:x*2+1,y:y*2+1,z:z*2+1}); }
    } else if (currentLayout === 'aperiodic') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
            const s=(x*123+y*456+z*789);
            candidates.push({x:x+Math.sin(s)*0.5,y:y+Math.cos(s)*0.5,z:z+Math.sin(s*0.5)*0.5});
        }
    } else if (currentLayout === 'hcp') {
        const s3=Math.sqrt(3),cz=Math.sqrt(2/3);
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
            const even=(Math.abs(z)%2===0);
            candidates.push({x:x+(Math.abs(y)%2)*0.5+(even?0:0.5),y:y*(s3/2)+(even?0:s3/6),z:z*cz});
        }
    } else if (currentLayout === 'diamond_c') {
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
            if(Math.abs(x+y+z)%2===0) { candidates.push({x,y,z}); candidates.push({x:x+0.5,y:y+0.5,z:z+0.5}); }
        }
    } else if (currentLayout === 'gyroid') {
        const sc=0.3;
        for(let x=-range;x<=range;x++) for(let y=-range;y<=range;y++) for(let z=-range;z<=range;z++) {
            const f=Math.abs(Math.sin(x*sc)*Math.cos(y*sc)+Math.sin(y*sc)*Math.cos(z*sc)+Math.sin(z*sc)*Math.cos(x*sc));
            if(f<0.5) candidates.push({x,y,z});
        }
    }

    if      (currentFillMode==='shell')   candidates.sort((a,b)=>(a.x*a.x+a.y*a.y+a.z*a.z)-(b.x*b.x+b.y*b.y+b.z*b.z));
    else if (currentFillMode==='cubic')   candidates.sort((a,b)=>Math.max(Math.abs(a.x),Math.abs(a.y),Math.abs(a.z))-Math.max(Math.abs(b.x),Math.abs(b.y),Math.abs(b.z)));
    else if (currentFillMode==='diamond') candidates.sort((a,b)=>(Math.abs(a.x)+Math.abs(a.y)+Math.abs(a.z))-(Math.abs(b.x)+Math.abs(b.y)+Math.abs(b.z)));
    else if (currentFillMode==='linear') {
        if (linearStride<=0) {
            candidates.sort((a,b)=>(a.z-b.z)||(a.y-b.y)||(a.x-b.x));
        } else {
            const W=linearStride;
            const xMin=candidates.reduce((m,c)=>Math.min(m,c.x),Infinity);
            candidates.sort((a,b)=>{
                if(a.z!==b.z) return a.z-b.z;
                const sA=Math.floor((a.x-xMin)/W), sB=Math.floor((b.x-xMin)/W);
                if(sA!==sB) return sA-sB;
                if(a.y!==b.y) return a.y-b.y;
                return a.x-b.x;
            });
        }
    }
    else if (currentFillMode==='vortex')  candidates.sort((a,b)=>(Math.abs(a.z-b.z)>0.5?a.z-b.z:Math.atan2(a.y,a.x)-Math.atan2(b.y,b.x)));
    else if (currentFillMode==='outside') candidates.sort((a,b)=>(b.x*b.x+b.y*b.y+b.z*b.z)-(a.x*a.x+a.y*a.y+a.z*a.z));
    else if (currentFillMode==='zorder') {
        let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity,z0=Infinity,z1=-Infinity;
        for(const c of candidates){if(c.x<x0)x0=c.x;if(c.x>x1)x1=c.x;if(c.y<y0)y0=c.y;if(c.y>y1)y1=c.y;if(c.z<z0)z0=c.z;if(c.z>z1)z1=c.z;}
        const scl=255/Math.max(x1-x0,y1-y0,z1-z0,1);
        for(const c of candidates){
            const ix=Math.round((c.x-x0)*scl),iy=Math.round((c.y-y0)*scl),iz=Math.round((c.z-z0)*scl);
            let m=0; for(let i=0;i<8;i++) m|=((ix>>i&1)<<(3*i))|((iy>>i&1)<<(3*i+1))|((iz>>i&1)<<(3*i+2));
            c._m=m;
        }
        candidates.sort((a,b)=>a._m-b._m);
    }
    else if (currentFillMode==='modular') {
        const M=6,bkts=Array.from({length:M},()=>[]);
        for(const c of candidates) bkts[Math.floor(((Math.atan2(c.y,c.x)+Math.PI)/(2*Math.PI))*M)%M].push(c);
        const d2=c=>c.x*c.x+c.y*c.y+c.z*c.z;
        for(const b of bkts) b.sort((a,b)=>d2(a)-d2(b));
        candidates=[];
        const ml=Math.max(...bkts.map(b=>b.length));
        for(let k=0;k<ml;k++) for(let r=0;r<M;r++) if(k<bkts[r].length) candidates.push(bkts[r][k]);
    }

    for(let i=0;i<MAX_POINTS;i++){
        const c=candidates[i]||{x:0,y:0,z:0};
        targetPositions[i*3]=c.x*currentSpacing;
        targetPositions[i*3+1]=c.y*currentSpacing;
        targetPositions[i*3+2]=c.z*currentSpacing;
    }
}

// ---------------------------------------------------------------------------
// Particles / shaders
// ---------------------------------------------------------------------------
function createParticles() {
    geometry = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_POINTS * 3);
    const nums = new Float32Array(MAX_POINTS);
    for (let n = 1; n <= MAX_POINTS; n++) {
        nums[n-1] = n;
        pos[(n-1)*3]   = (Math.random()-0.5)*5000;
        pos[(n-1)*3+1] = (Math.random()-0.5)*5000;
        pos[(n-1)*3+2] = (Math.random()-0.5)*5000;
    }
    geometry.setAttribute('position',    new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('number',      new THREE.BufferAttribute(nums, 1));
    geometry.setAttribute('customColor', new THREE.BufferAttribute(new Float32Array(MAX_POINTS*3), 3));
    geometry.setAttribute('size',        new THREE.BufferAttribute(new Float32Array(MAX_POINTS), 1));
    updateParticleVisuals();

    const material = new THREE.ShaderMaterial({
        uniforms: {
            atlas:      { value: createNumberAtlas() },
            starTex:    { value: createGlowTexture() },
            uShowLabels:{ value: 1.0 }
        },
        vertexShader: `
            attribute float size; attribute float number; attribute vec3 customColor;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                vColor = customColor; vNumber = number; vSize = size;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vDistance = -mvPosition.z;
                gl_PointSize = max(size * (1500.0 / vDistance), 0.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform sampler2D atlas; uniform sampler2D starTex; uniform float uShowLabels;
            varying vec3 vColor; varying float vNumber; varying float vDistance; varying float vSize;
            void main() {
                float n = floor(vNumber + 0.5);
                if (n < 0.5 || vSize < 0.1) discard;
                float currentPointSize = max(vSize * (1500.0 / vDistance), 0.0);
                float isPrime = step(50.0, vSize);
                float numMix = uShowLabels * isPrime * smoothstep(2500.0, 800.0, vDistance);
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
    points = new THREE.Points(geometry, material);
    scene.add(points);
}

function createNumberAtlas() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const slotW = 102.4;
    ctx.font = 'bold 108px "Share Tech Mono","Courier New",monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < 10; i++) {
        const cx = i * slotW + slotW * 0.5;
        ctx.shadowColor = 'rgba(0,220,255,0.9)'; ctx.shadowBlur = 14;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(i.toString(), cx, 64);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
}

function createGlowTexture() {
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

// ---------------------------------------------------------------------------
// WebXR
// ---------------------------------------------------------------------------
async function enterVR() {
    if (!vrSupported) return;
    if (vrSession) { await vrSession.end(); return; }
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor','bounded-floor','hand-tracking']
        });
        vrSession = session;
        renderer.xr.setSession(session);
        controls.enabled = false;
        controls.autoRotate = false;
        renderer.xr.getCamera().position.set(0,1600,4000);
        session.addEventListener('end', () => {
            vrSession = null;
            controls.enabled = true;
            controls.autoRotate = true;
            document.getElementById('vr-btn').textContent = 'Enter VR';
        });
        document.getElementById('vr-btn').textContent = 'Exit VR';
    } catch(e) { console.error('VR session failed:', e); }
}

// ---------------------------------------------------------------------------
// Resize / animate
// ---------------------------------------------------------------------------
function onWindowResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.fov = 60; camera.updateProjectionMatrix();
    if (stereoMode !== 'off') {
        cameraL.aspect = (w/2)/h; cameraR.aspect = (w/2)/h;
        cameraL.updateProjectionMatrix(); cameraR.updateProjectionMatrix();
    }
}

function animate() {
    if (autoGrow && activePointCount < MAX_POINTS) {
        growSpeed *= 1.005;
        activePointCount = Math.min(MAX_POINTS, activePointCount + Math.floor(growSpeed));
        updateUI();
        updateParticleVisuals();
    }
    const p = geometry.attributes.position.array;
    for (let i = 0; i < MAX_POINTS * 3; i++) p[i] += (targetPositions[i] - p[i]) * lerpSpeed;
    geometry.attributes.position.needsUpdate = true;

    if (!vrSession) controls.update();

    const W = window.innerWidth, H = window.innerHeight;
    renderer.setScissorTest(false);
    renderer.setViewport(0,0,W,H);
    renderer.clear();

    if (vrSession) {
        renderer.render(scene, camera);
    } else if (stereoMode !== 'off') {
        const eyeSep = 45;
        cameraL.copy(camera); cameraR.copy(camera);
        cameraL.aspect=(W/2)/H; cameraL.updateProjectionMatrix();
        cameraR.aspect=(W/2)/H; cameraR.updateProjectionMatrix();
        cameraL.translateX(-eyeSep); cameraR.translateX(eyeSep);
        renderer.setScissorTest(true);
        renderer.setViewport(0,0,W/2,H); renderer.setScissor(0,0,W/2,H);
        renderer.render(scene, stereoMode==='parallel' ? cameraL : cameraR);
        renderer.setViewport(W/2,0,W/2,H); renderer.setScissor(W/2,0,W/2,H);
        renderer.render(scene, stereoMode==='parallel' ? cameraR : cameraL);
        renderer.setScissorTest(false);
    } else {
        renderer.render(scene, camera);
    }
}

document.fonts.ready.then(() => init());

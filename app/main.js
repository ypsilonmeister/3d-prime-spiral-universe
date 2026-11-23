// Composition root / main entrypoint booting sequence

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { state } from './state.js';
import { initWorker, isWorkerReady, setWorkerReady, setZetaProgressCallback } from './worker-client.js';
import { buildSieve } from '../shared/sieve.js';
import { computeNtlTables } from '../shared/arithmetic.js';

import { createParticles, classifyNumbers } from './render/particles.js';
import { animate, setFrameTickCallback, setSieveTickCallback } from './render/loop.js';

import {
    initElements, getElement, setBootStage, hideBootOverlay, buildTypeUI, updateUI, setupHelpTooltips,
    onBootProgress, onSieveProgress, onSieveUIUpdate, onZetaProgress
} from './ui/panels.js';
import { bindUIEvents, toggleType } from './ui/bindings.js';

import { initModeManager, setUIDisabledStateUpdateCallback, rebuildPositions, toggleMode } from './modes/mode-manager.js';
import { sieveTick, setSieveCallbacks } from './modes/sieve-anim.js';
import { parseLaunchOptions } from './launch-options.js';

// Debug/test handle: exposes the app state so end-to-end tests can assert on
// committed positions. Harmless for a visualization with no secrets.
if (typeof window !== 'undefined') {
    window.__APP_STATE__ = state;
}

function onWindowResize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (state.renderer) {
        state.renderer.setSize(W, H);
    }
    if (state.camera) {
        state.camera.aspect = W / H;
        state.camera.fov = 60;
        state.camera.updateProjectionMatrix();
    }
    if (state.points && state.points.material) {
        state.points.material.uniforms.uViewHeight.value = H;
    }
    if (state.stereoMode !== 'off' && state.cameraL && state.cameraR) {
        state.cameraL.aspect = (W / 2) / H;
        state.cameraR.aspect = (W / 2) / H;
        state.cameraL.updateProjectionMatrix();
        state.cameraR.updateProjectionMatrix();
    }
}

async function enterVR() {
    if (!state.vrSupported) return;
    if (state.vrSession) {
        await state.vrSession.end();
        return;
    }
    try {
        const session = await navigator.xr.requestSession('immersive-vr', {
            optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        });
        state.vrSession = session;
        state.renderer.xr.setSession(session);
        state.controls.enabled = false;
        state.controls.autoRotate = false;
        state.renderer.xr.getCamera().position.set(0, 1600, 4000);
        
        session.addEventListener('end', () => {
            state.vrSession = null;
            state.controls.enabled = true;
            state.controls.autoRotate = true;
            const btn = getElement('vr-btn');
            if (btn) btn.textContent = 'Enter VR';
        });
        const btn = getElement('vr-btn');
        if (btn) btn.textContent = 'Exit VR';
    } catch (e) {
        console.error('VR session failed:', e);
    }
}

function init(launch) {
    state.scene = new THREE.Scene();

    state.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 200000);
    state.camera.position.set(3000, 3000, 5000);

    state.cameraL = new THREE.PerspectiveCamera(60, (window.innerWidth / 2) / window.innerHeight, 1, 200000);
    state.cameraR = new THREE.PerspectiveCamera(60, (window.innerWidth / 2) / window.innerHeight, 1, 200000);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setSize(window.innerWidth, window.innerHeight);
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    state.renderer.setClearColor(0x010103, 1);
    state.renderer.autoClear = false;
    state.renderer.xr.enabled = true;
    
    const container = getElement('canvas-container');
    if (container) {
        container.appendChild(state.renderer.domElement);
    }

    state.controls = new OrbitControls(state.camera, state.renderer.domElement);
    state.controls.enableDamping = true;
    state.controls.autoRotate = true;
    state.controls.autoRotateSpeed = 0.15;

    if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then(supported => {
            state.vrSupported = supported;
            if (supported) {
                const btn = getElement('vr-btn');
                if (btn) btn.style.display = '';
            }
        });
    }

    classifyNumbers();
    buildTypeUI(toggleType);
    createParticles();
    setupHelpTooltips();

    window.addEventListener('resize', onWindowResize);

    // Setup loop tick callbacks to update UI
    setFrameTickCallback(updateUI);
    setSieveTickCallback(sieveTick);
    setSieveCallbacks(onSieveProgress, onSieveUIUpdate);
    setZetaProgressCallback(onZetaProgress);

    initModeManager();
    setUIDisabledStateUpdateCallback(updateUI);

    bindUIEvents(enterVR);

    if (launch && launch.mode === 'explicit') {
        if (launch.kind) state.explicitKind = launch.kind;
        if (launch.view) state.explicitView = launch.view;
        // Skip the initial normal lattice build (753k candidate sort) and avoid
        // a double fullRebuild(). Exiting Explicit Formula Mode lazily builds
        // the normal lattice via mode-manager.js -> rebuildPositions().
        toggleMode('explicit', {
            fromLaunch: true,
            autoSweep: Boolean(launch.autoSweep),
            sweepDelayMs: 450,
        });
    } else {
        // Build the lattice AND commit it into the live target buffer. Using
        // rebuildPositions (not bare calculateTargetPositions) ensures the points
        // lerp toward the lattice instead of collapsing to the origin.
        rebuildPositions();
    }
    updateUI();

    state.renderer.setAnimationLoop(animate);
}

function _fallbackBuildOnMainThread() {
    const { isPrime, gaps, spf } = buildSieve(state.MAX_POINTS);
    state.isPrimeArray = isPrime;
    state.primeGaps    = gaps;

    const { ntl_d, ntl_sigma, ntl_omega, ntl_mu, ntl_phi } = computeNtlTables(state.MAX_POINTS, spf);
    state.ntl_d        = ntl_d;
    state.ntl_sigma    = ntl_sigma;
    state.ntl_omega    = ntl_omega;
    state.ntl_mu       = ntl_mu;
    state.ntl_phi      = ntl_phi;
    
    setWorkerReady(false);
}

const _nixieFont = new FontFace(
    'Nixie One',
    "url(https://fonts.gstatic.com/s/nixieone/v17/lW-8wjkKLXjg5y2o2uUoUA.woff2) format('woff2')," +
    "url(https://fonts.gstatic.com/s/nixieone/v17/lW-8wjkKLXjg5y2o2uUoUA.ttf) format('truetype')"
);

async function boot() {
    const reducedMotion = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const launch = parseLaunchOptions(
        typeof window !== 'undefined' ? window.location.search : '',
        { reducedMotion },
    );
    initElements();
    setBootStage('Loading font…', 2);
    const fontPromise = Promise.race([
        _nixieFont.load().then(f => document.fonts.add(f)).catch(() => {}),
        new Promise(r => setTimeout(r, 5000)),
    ]);
    setBootStage('Spinning up worker…', 5);
    try {
        await initWorker(onBootProgress);
    } catch (e) {
        console.error('Worker init failed, falling back to main-thread sieves', e);
        _fallbackBuildOnMainThread();
    }
    await fontPromise;
    setBootStage(launch.mode === 'explicit' ? 'Preparing Explicit Formula…' : 'Building lattice…', 99);
    init(launch);
    setBootStage('Ready', 100);
    requestAnimationFrame(() => hideBootOverlay());
}

boot();

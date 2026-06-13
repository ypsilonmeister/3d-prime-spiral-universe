// Application global state and constants

export const state = {
    // Constants
    MAX_POINTS: 320000,
    
    // Core parameters
    activePointCount: 320000,
    currentLayout: 'cube',
    currentFillMode: 'shell',
    currentSpacing: 65,
    compositeMode: 'both',
    colorMode: 'spectrum',
    stereoMode: 'off',
    uiVisible: true,
    showLabels: true,
    autoGrow: false,
    growSpeed: 50,
    linearStride: 0,
    
    // Target buffer & physics
    targetPositions: new Float32Array(320000 * 3),
    baseTargetPositions: new Float32Array(320000 * 3),
    lerpSpeed: 0.05,
    lerpActive: true,
    _maxRenderedCount: 0,
    growUICounter: 0,

    // p-adic mode
    padicModeActive: false,
    padicP: 2,
    padicAnimating: false,
    padicAnimFrame: null,
    padicColorMode: false,
    padicVal: new Int16Array(320000 + 1),

    // NTL mode
    ntlModeActive: false,
    ntlFunc: 'd',
    ntlScale: 1.0,
    ntlHighlightPerfect: false,
    ntlHighlightHC: false,
    ntl_d: new Uint16Array(320000 + 1),
    ntl_sigma: new Float32Array(320000 + 1),
    ntl_omega: new Uint8Array(320000 + 1),
    ntl_mu: new Int8Array(320000 + 1),
    ntl_phi: new Uint32Array(320000 + 1),
    ntlOffsets: new Float32Array(320000),

    // Sieve mode
    sieveModeActive: false,
    sievePlaying: false,
    sieveSpeed: 1.0,
    sieveCurrentP: 2,
    sieveNextMultiple: 4,
    sieveLimit: 0,
    sieveFinished: false,
    sieveFoundCount: 0,
    sieveState: new Uint8Array(320000 + 1),
    sieveAlpha: new Float32Array(320000 + 1).fill(1.0),
    sieveAccum: 0,

    // Prime dimension mode
    primeDimModeActive: false,
    primeDimP: [2, 3, 5],
    primeDimOnlyChosen: false,
    primeDimValX: new Int16Array(320000 + 1),
    primeDimValY: new Int16Array(320000 + 1),
    primeDimValZ: new Int16Array(320000 + 1),
    primeDimAxisLines: null,
    primeDimAxisLabels: [],

    // Zeta mode
    zetaModeActive: false,
    zetaZeroCount: 0,
    zetaAmplitude: 1.0,
    zetaAnimating: false,
    zetaAnimFrame: null,
    zetaOffsets: new Float32Array(320000),

    // Math buffers loaded from worker
    isPrimeArray: new Uint8Array(320000 + 1),
    primeGaps: new Uint8Array(320000 + 2),
    numberType: new Array(320000 + 1),
    particleTypeDef: new Array(320000 + 1),
    typeVisibility: {}, // populated dynamically
    
    // Three.js instances
    scene: null,
    camera: null,
    cameraL: null,
    cameraR: null,
    renderer: null,
    controls: null,
    points: null,
    geometry: null,
    
    // WebXR
    vrSession: null,
    vrSupported: false,
    lastTapTime: 0
};

// Simple subscription/event system for state changes
const listeners = new Set();

export function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
}

export function updateState(updates) {
    let changed = false;
    for (const [key, val] of Object.entries(updates)) {
        if (state[key] !== val) {
            state[key] = val;
            changed = true;
        }
    }
    if (changed) {
        for (const callback of listeners) {
            callback(state);
        }
    }
}

// Prime Number Music Generator
// Web Audio API + Canvas — no dependencies

'use strict';

// ── Riemann zeta non-trivial zeros (imaginary parts γ_n) ─────────────────────
// First 50 zeros from Odlyzko's tables
const ZETA_ZEROS = [
    14.134725, 21.022040, 25.010858, 30.424876, 32.935062,
    37.586178, 40.918719, 43.327073, 48.005151, 49.773832,
    52.970321, 56.446247, 59.347044, 60.831779, 65.112544,
    67.079811, 69.546401, 72.067157, 75.704691, 77.144840,
    79.337375, 82.910381, 84.735493, 87.425274, 88.809111,
    92.491899, 94.651344, 95.870634, 98.831194, 101.317851,
    103.725538, 105.446623, 107.168611, 111.029535, 111.874659,
    114.320220, 116.226680, 118.790782, 121.370125, 122.946829,
    124.256819, 127.516683, 129.578704, 131.087688, 133.497737,
    134.756510, 138.116042, 139.736208, 141.123707, 143.111845,
];

// ── Number theory tables ──────────────────────────────────────────────────────

const MAX_N = 10000;

// Sieve of Eratosthenes
const _sieve = new Uint8Array(MAX_N + 1).fill(1);
_sieve[0] = _sieve[1] = 0;
for (let i = 2; i * i <= MAX_N; i++)
    if (_sieve[i]) for (let j = i * i; j <= MAX_N; j += i) _sieve[j] = 0;

function isPrime(n) { return n >= 2 && _sieve[n] === 1; }

// Smallest prime factor (for factorisation)
const _spf = new Uint16Array(MAX_N + 1);
for (let i = 0; i <= MAX_N; i++) _spf[i] = i;
for (let i = 2; i * i <= MAX_N; i++)
    if (_spf[i] === i) for (let j = i * i; j <= MAX_N; j += i)
        if (_spf[j] === j) _spf[j] = i;

function factorise(n) {
    // Returns Map { prime → exponent }
    const f = new Map();
    while (n > 1) {
        const p = _spf[n];
        let e = 0;
        while (n % p === 0) { n = Math.floor(n / p); e++; }
        f.set(p, e);
    }
    return f;
}

function mobius(n) {
    if (n === 1) return 1;
    const f = factorise(n);
    for (const e of f.values()) if (e > 1) return 0;
    return f.size % 2 === 0 ? 1 : -1;
}

function divisorCount(n) {
    if (n === 1) return 1;
    let d = 1;
    for (const e of factorise(n).values()) d *= (e + 1);
    return d;
}

// ── Audio engine ──────────────────────────────────────────────────────────────

let audioCtx = null;
let masterGain = null;
let reverbNode = null;
let reverbDryNode = null;
let reverbWetNode = null;
let analyserNode = null;
let mediaRecorder = null;
let recordedChunks = [];

function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;

    analyserNode = audioCtx.createAnalyser();
    analyserNode.fftSize = 2048;

    // Simple convolver reverb (synthesised impulse)
    reverbNode    = audioCtx.createConvolver();
    reverbDryNode = audioCtx.createGain();
    reverbWetNode = audioCtx.createGain();
    reverbDryNode.gain.value = 0.7;
    reverbWetNode.gain.value = 0.3;
    reverbNode.buffer = makeImpulse(audioCtx, 2.0, 0.5);

    masterGain.connect(reverbDryNode);
    masterGain.connect(reverbNode);
    reverbNode.connect(reverbWetNode);
    reverbDryNode.connect(analyserNode);
    reverbWetNode.connect(analyserNode);
    analyserNode.connect(audioCtx.destination);
}

function makeImpulse(ctx, duration, decay) {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * duration);
    const buf = ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < len; i++)
            d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 3);
    }
    return buf;
}

// Play a short click / tone at given frequency and duration
function playTone(freq, duration, gain = 0.5, wave = currentWave, detune = 0) {
    if (!audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(env);
    env.connect(masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.01);
}

// Sharp percussive click (prime marker)
function playClick(freq, gain = 0.6) {
    playTone(freq, 0.06, gain, currentWave);
    // Extra sub-click for presence
    playTone(freq * 2, 0.03, gain * 0.3, 'sine');
}

// Sustaining zeta tone (long-running oscillators managed separately)
const _zetaOscs = [];
function startZetaTones(count, ampPct) {
    stopZetaTones();
    if (!audioCtx) return;
    const amp = (ampPct / 100) * 0.08;
    for (let i = 0; i < Math.min(count, ZETA_ZEROS.length); i++) {
        const gamma = ZETA_ZEROS[i];
        // Map γ to audible freq: use log scale anchored to base pitch
        const freq = basePitch * Math.pow(2, Math.log2(gamma / 14.135));
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = amp / Math.sqrt(i + 1); // higher zeros quieter
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start();
        _zetaOscs.push({ osc, gain });
    }
}

function stopZetaTones() {
    for (const { osc } of _zetaOscs) { try { osc.stop(); } catch (_) {} }
    _zetaOscs.length = 0;
}

// ── State ─────────────────────────────────────────────────────────────────────

let currentMode  = 'primes';
let isPlaying    = false;
let isRecording  = false;
let currentN     = 1;
let startN       = 1;
let speed        = 20;      // integers per second
let zetaCount    = 10;
let zetaAmp      = 40;
let volume       = 70;
let reverbWet    = 30;
let basePitch    = 110;     // Hz (A2)
let currentWave  = 'sine';

let _scheduleTimer = null;
let _lastScheduleTime = 0;  // audioCtx time of last scheduled event

// ── Playback scheduler (look-ahead pattern) ───────────────────────────────────

const LOOKAHEAD_MS   = 25;   // schedule interval
const SCHEDULE_AHEAD = 0.1;  // seconds of audio to schedule ahead

function pausePlayback() {
    isPlaying = false;
    clearInterval(_scheduleTimer);
    document.getElementById('btn-play').textContent = '▶';
    document.getElementById('btn-play').classList.remove('active');
    stopZetaTones();
    // Pause the recorder so chunks are preserved; resume continues the same take.
    if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.pause();
}

function stopPlay() {
    pausePlayback();
    currentN = startN;
    updateCounterDisplay(currentN);
    if (isRecording) finaliseRecording();
}

// Schedule audio events for integer n at audioCtx time t
function scheduleN(n, t) {
    switch (currentMode) {
        case 'primes':    schedulePrimes(n, t); break;
        case 'zeta':      /* continuous tones, no per-n events */ break;
        case 'combined':  schedulePrimes(n, t); break;
        case 'padic':     schedulePadic(n, t); break;
        case 'mobius':    scheduleMobius(n, t); break;
        case 'divisors':  scheduleDivisors(n, t); break;
        case 'sieve':     scheduleSieve(n, t); break;
    }
}

// ── Mode schedulers ───────────────────────────────────────────────────────────

function schedulePrimes(n, t) {
    if (!isPrime(n)) return;
    const freq = nToFreq(n);
    scheduleClick(freq, 0.65, t);
}

function schedulePadic(n, t) {
    if (n < 2) return;
    const factors = factorise(n);
    let i = 0;
    for (const [p, e] of factors) {
        // Map prime index to pitch interval
        const primeIdx = primeIndex(p);
        const freq = basePitch * Math.pow(2, (primeIdx % 12) / 12 + Math.floor(primeIdx / 12));
        const gain = 0.35 * e / (factors.size + i * 0.2);
        scheduleNote(freq, 1 / speed * 0.8, gain, t, i * 0.002);
        i++;
    }
}

function scheduleMobius(n, t) {
    const mu = mobius(n);
    if (mu === 0) return;                      // square factor → silence
    const freq = mu === 1 ? basePitch * 2 : basePitch;
    scheduleNote(freq, 1 / speed * 0.5, 0.45, t);
}

function scheduleDivisors(n, t) {
    const d = divisorCount(n);
    const freq = basePitch * Math.pow(2, (d - 1) / 12);
    const gain = Math.min(0.7, 0.1 + d * 0.04);
    const dur = Math.min(1 / speed * 2, 0.4);
    scheduleNote(freq, dur, gain, t);
}

function scheduleSieve(n, t) {
    // Play a tone for n, then sweep-mark its multiples (audible as fading echo)
    if (n < 2) return;
    if (isPrime(n)) {
        // Prime announcement — bright click
        scheduleClick(nToFreq(n), 0.7, t);
    } else {
        // Composite — soft thud
        const spf = _spf[n];
        const freq = nToFreq(spf) * 0.5;
        scheduleNote(freq, 0.04, 0.18, t);
    }
}

// ── Low-level audio schedulers (use audioCtx.currentTime offset) ─────────────

function scheduleClick(freq, gain, t) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = currentWave;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    osc.connect(env); env.connect(masterGain);
    osc.start(t); osc.stop(t + 0.08);
}

function scheduleNote(freq, dur, gain, t, delaySec = 0) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const env = audioCtx.createGain();
    osc.type = currentWave;
    osc.frequency.value = freq;
    const start = t + delaySec;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.01);
    env.gain.exponentialRampToValueAtTime(0.001, start + dur);
    osc.connect(env); env.connect(masterGain);
    osc.start(start); osc.stop(start + dur + 0.02);
}

// ── Frequency mapping ─────────────────────────────────────────────────────────

// Map integer n to frequency — log scale anchored at basePitch
function nToFreq(n) {
    // Use prime-counting approximation: semitone per prime step
    const idx = primeIndex(n);
    if (idx < 0) {
        // non-prime: use harmonic series
        return basePitch * (n / Math.floor(Math.sqrt(n) + 1));
    }
    return basePitch * Math.pow(2, (idx % 24) / 12);
}

// Get 0-based index of prime (0=2, 1=3, 2=5, ...)
// Cached for speed
const _primeIdxCache = new Map();
let   _primeIdxNext  = 0;
let   _primeIdxN     = 2;
function primeIndex(n) {
    if (!isPrime(n)) return -1;
    if (_primeIdxCache.has(n)) return _primeIdxCache.get(n);
    // Walk up to n
    while (_primeIdxN <= n) {
        if (isPrime(_primeIdxN)) { _primeIdxCache.set(_primeIdxN, _primeIdxNext++); }
        _primeIdxN++;
    }
    return _primeIdxCache.get(n) ?? -1;
}

// ── Recording ─────────────────────────────────────────────────────────────────

function startMediaCapture() {
    if (!audioCtx) return;
    const dest = audioCtx.createMediaStreamDestination();
    // Connect masterGain (the root of all audio) so the recording captures everything.
    // analyserNode sits downstream and is not the source.
    masterGain.connect(dest);
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.start(100);
    document.getElementById('rec-status').textContent = 'Recording…';
}

function finaliseRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.onstop = () => {
        document.getElementById('rec-status').textContent = 'Ready to download';
        document.getElementById('btn-export').disabled = false;
    };
    mediaRecorder.stop();
}

function toggleRec() {
    if (!isRecording) {
        isRecording = true;
        document.getElementById('btn-rec').classList.add('active');
        document.getElementById('rec-status').textContent = 'Arm: play to start';
        document.getElementById('btn-export').disabled = true;
        if (isPlaying) startMediaCapture();
    } else {
        isRecording = false;
        document.getElementById('btn-rec').classList.remove('active');
        finaliseRecording();
    }
}

function exportWav() {
    if (!recordedChunks.length) return;
    const blob = new Blob(recordedChunks, { type: 'audio/webm' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `prime-music-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Visualiser ────────────────────────────────────────────────────────────────

const waveCanvas = document.getElementById('wave-canvas');
const wctx       = waveCanvas.getContext('2d');
const numCanvas  = document.getElementById('number-canvas');
const nctx       = numCanvas.getContext('2d');

// Number strip: ring buffer of recent n values
const STRIP_LEN = 80;
const _strip = Array.from({ length: STRIP_LEN }, (_, i) => ({ n: i + 1, t: 0 }));
let _stripHead = 0;

function pushStrip(n) {
    _strip[_stripHead % STRIP_LEN] = { n, t: performance.now() };
    _stripHead++;
}

let _rafId = null;
function drawLoop(now) {
    if (!isPlaying) { _rafId = null; return; }
    _rafId = requestAnimationFrame(drawLoop);

    // ── Compute current n from audio clock ────────────────────────────────────
    if (audioCtx) {
        const elapsed = audioCtx.currentTime - (_lastScheduleTime - SCHEDULE_AHEAD);
        const displayN = Math.max(startN, currentN - Math.ceil(speed * SCHEDULE_AHEAD) + 1);
        updateCounterDisplay(displayN);
    }

    drawWaveform();
    drawNumberStrip();
}

function updateCounterDisplay(n) {
    const el = document.getElementById('n-value');
    const tag = document.getElementById('n-tag');
    el.textContent = n;
    if (isPrime(n)) {
        el.classList.add('prime-flash');
        tag.textContent = 'PRIME';
    } else {
        el.classList.remove('prime-flash');
        const mu = mobius(n);
        tag.textContent = mu === 0 ? 'square factor' : mu === 1 ? 'μ=+1' : 'μ=−1';
    }
}

function drawWaveform() {
    // Use CSS dimensions — ctx is already scaled by DPR via setTransform.
    const W = waveCanvas.clientWidth, H = waveCanvas.clientHeight;
    wctx.clearRect(0, 0, W, H);

    wctx.fillStyle = '#010102';
    wctx.fillRect(0, 0, W, H);

    if (!analyserNode) return;
    const buf = new Float32Array(analyserNode.fftSize);
    analyserNode.getFloatTimeDomainData(buf);

    wctx.beginPath();
    wctx.strokeStyle = '#00f2ff';
    wctx.lineWidth = 1.5;
    wctx.shadowColor = '#00f2ff';
    wctx.shadowBlur = 8;

    const sliceW = W / buf.length;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
        const y = (0.5 + buf[i] * 0.45) * H;
        if (i === 0) wctx.moveTo(x, y); else wctx.lineTo(x, y);
        x += sliceW;
    }
    wctx.stroke();
    wctx.shadowBlur = 0;

    wctx.beginPath();
    wctx.strokeStyle = 'rgba(0,242,255,0.12)';
    wctx.lineWidth = 0.5;
    wctx.moveTo(0, H / 2); wctx.lineTo(W, H / 2);
    wctx.stroke();
}

function drawNumberStrip() {
    // Use CSS dimensions — ctx is already scaled by DPR via setTransform.
    const W = numCanvas.clientWidth, H = numCanvas.clientHeight;
    nctx.clearRect(0, 0, W, H);
    nctx.fillStyle = 'rgba(1,1,2,0.9)';
    nctx.fillRect(0, 0, W, H);

    if (!isPlaying) return;

    const cellW = W / STRIP_LEN;
    const now   = performance.now();

    // Draw STRIP_LEN most recent n values
    for (let i = 0; i < STRIP_LEN; i++) {
        const idx = (_stripHead - STRIP_LEN + i + STRIP_LEN * 2) % STRIP_LEN;
        const { n, t } = _strip[idx];
        const age = (now - t) / 1000;   // seconds
        const alpha = Math.max(0, 1 - age * (speed / 30));
        const x = i * cellW;

        if (isPrime(n)) {
            nctx.fillStyle = `rgba(255,215,0,${alpha * 0.9})`;
            nctx.fillRect(x, 0, cellW - 1, H);
            nctx.fillStyle = `rgba(0,0,0,${alpha})`;
        } else {
            const mu = mobius(n);
            const col = mu === 0 ? `rgba(80,40,80,${alpha * 0.6})` :
                        mu === 1 ? `rgba(0,80,120,${alpha * 0.5})` :
                                   `rgba(120,40,0,${alpha * 0.5})`;
            nctx.fillStyle = col;
            nctx.fillRect(x, 0, cellW - 1, H);
            nctx.fillStyle = `rgba(200,200,200,${alpha * 0.6})`;
        }

        if (cellW > 12) {
            nctx.font = `${Math.min(10, cellW * 0.55)}px Orbitron`;
            nctx.textAlign = 'center';
            nctx.textBaseline = 'middle';
            nctx.fillText(n, x + cellW / 2, H / 2);
        }
    }
}

// ── Resize ────────────────────────────────────────────────────────────────────

function resize() {
    const dpr = window.devicePixelRatio || 1;
    const main = document.getElementById('main-area');
    const numH = 90;

    waveCanvas.width  = main.clientWidth  * dpr;
    waveCanvas.height = (main.clientHeight - numH) * dpr;
    waveCanvas.style.width  = main.clientWidth + 'px';
    waveCanvas.style.height = (main.clientHeight - numH) + 'px';
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    numCanvas.width  = main.clientWidth  * dpr;
    numCanvas.height = numH * dpr;
    numCanvas.style.width  = main.clientWidth + 'px';
    numCanvas.style.height = numH + 'px';
    nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resize);

// ── Control handlers ──────────────────────────────────────────────────────────

function setMode(val) {
    currentMode = val;
    if (isPlaying) {
        stopZetaTones();
        if (val === 'zeta' || val === 'combined') startZetaTones(zetaCount, zetaAmp);
    }
    updateModeDescription();
}

function setSpeed(val) {
    speed = val;
    document.getElementById('speed-val').textContent = val;
}

function setStart(val) {
    startN = val;
    document.getElementById('start-val').textContent = val;
    if (!isPlaying) { currentN = val; updateCounterDisplay(val); }
}

function setZetaCount(val) {
    zetaCount = val;
    document.getElementById('zeta-count-val').textContent = val;
    if (isPlaying && (currentMode === 'zeta' || currentMode === 'combined')) {
        stopZetaTones();
        startZetaTones(zetaCount, zetaAmp);
    }
}

function setZetaAmp(val) {
    zetaAmp = val;
    document.getElementById('zeta-amp-val').textContent = val;
    if (!audioCtx) return;
    if (isPlaying && (currentMode === 'zeta' || currentMode === 'combined')) {
        const amp = (val / 100) * 0.08;
        _zetaOscs.forEach(({ gain }, i) => {
            gain.gain.setTargetAtTime(amp / Math.sqrt(i + 1), audioCtx.currentTime, 0.05);
        });
    }
}

function setVolume(val) {
    volume = val;
    document.getElementById('vol-val').textContent = val;
    if (!audioCtx || !masterGain) return;
    masterGain.gain.setTargetAtTime(val / 100, audioCtx.currentTime, 0.05);
}

function setReverb(val) {
    reverbWet = val;
    document.getElementById('reverb-val').textContent = val;
    if (!audioCtx || !reverbDryNode || !reverbWetNode) return;
    reverbDryNode.gain.setTargetAtTime(1 - val / 100, audioCtx.currentTime, 0.05);
    reverbWetNode.gain.setTargetAtTime(val / 100, audioCtx.currentTime, 0.05);
}

function setPitch(val) {
    basePitch = val;
    document.getElementById('pitch-val').textContent = val;
    if (isPlaying && (currentMode === 'zeta' || currentMode === 'combined')) {
        stopZetaTones();
        startZetaTones(zetaCount, zetaAmp);
    }
}

function setWave(val) {
    currentWave = val;
}

// ── Mode descriptions ─────────────────────────────────────────────────────────

const MODE_DESCRIPTIONS = {
    primes:
        'A click fires at every prime n.\n' +
        'Pitch maps to prime index (chromatic scale).\n' +
        'Listen for the irregular rhythm that encodes prime distribution.',
    zeta:
        'The first γ_n imaginary parts of Riemann zeta zeros become sustained tones.\n' +
        'By the explicit formula, this resonance encodes primes.\n' +
        'Adjust count and amplitude to hear the harmonic structure.',
    combined:
        'Prime clicks layered over zeta zero tones.\n' +
        'The Fourier duality between primes and zeros becomes audible:\n' +
        'clicks align with the interference of the continuous tones.',
    padic:
        'Each integer n is factored. Its prime factors become simultaneous tones.\n' +
        '12 = 2²·3 → two "2" tones + one "3" tone.\n' +
        'Highly composite numbers produce full chords.',
    mobius:
        'μ(n) = +1 (high), −1 (low), 0 (silence).\n' +
        'Square-free integers sound; square factors fall silent.\n' +
        'The rhythm encodes the Liouville function.',
    divisors:
        'd(n) determines pitch height (more divisors → higher).\n' +
        'Highly composite numbers ring bright and loud.\n' +
        'Primes are monotone — pitch 1 semitone above base.',
    sieve:
        'Eratosthenes sieve in real time.\n' +
        'Primes: bright announcement click.\n' +
        'Composites: soft thud pitched to their smallest prime factor.',
};

function updateModeDescription() {
    document.getElementById('mode-description').textContent =
        MODE_DESCRIPTIONS[currentMode] || '';
}

// ── Strip feeder ──────────────────────────────────────────────────────────────

function scheduleTick() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const scheduleUntil = now + SCHEDULE_AHEAD;
    const secondsPerN = 1 / speed;
    while (_lastScheduleTime < scheduleUntil) {
        if (currentN > MAX_N) { stopPlay(); return; }
        const n = currentN;
        const t = _lastScheduleTime;
        scheduleN(n, t);
        // Push to visual strip timed to when audio plays
        const delay = t - audioCtx.currentTime;
        setTimeout(() => pushStrip(n), Math.max(0, delay * 1000));
        currentN++;
        _lastScheduleTime += secondsPerN;
    }
}

function startPlayback() {
    if (!audioCtx) ensureAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    isPlaying = true;
    currentN  = startN;
    document.getElementById('btn-play').textContent = '⏸';
    document.getElementById('btn-play').classList.add('active');

    _lastScheduleTime = audioCtx.currentTime;

    if (currentMode === 'zeta' || currentMode === 'combined') {
        startZetaTones(zetaCount, zetaAmp);
    }
    // Recording: resume existing take if paused; start a new one only if armed but not yet started.
    if (isRecording) {
        if (mediaRecorder && mediaRecorder.state === 'paused') {
            mediaRecorder.resume();
        } else if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            startMediaCapture();
        }
    }

    clearInterval(_scheduleTimer);
    _scheduleTimer = setInterval(scheduleTick, LOOKAHEAD_MS);
    requestAnimationFrame(drawLoop);
}

// ── Expose to HTML ────────────────────────────────────────────────────────────

window.togglePlay    = () => { if (!isPlaying) startPlayback(); else pausePlayback(); };
window.stopPlay      = stopPlay;
window.toggleRec     = toggleRec;
window.exportWav     = exportWav;
window.setMode       = setMode;
window.setSpeed      = setSpeed;
window.setStart      = setStart;
window.setZetaCount  = setZetaCount;
window.setZetaAmp    = setZetaAmp;
window.setVolume     = setVolume;
window.setReverb     = setReverb;
window.setPitch      = setPitch;
window.setWave       = setWave;

// ── Boot ──────────────────────────────────────────────────────────────────────

updateModeDescription();
updateCounterDisplay(1);
resize();

// Draw idle waveform placeholder
(function idleDraw() {
    drawWaveform();
    drawNumberStrip();
})();

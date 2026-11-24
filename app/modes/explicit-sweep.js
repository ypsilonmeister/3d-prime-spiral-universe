// Non-linear 45-step N-sweep controller for Explicit Formula Mode (N = 0 -> 1000, ~10.5s, one-shot).
// Uses completion-driven scheduling: each step awaits reconstruction completion before scheduling the
// next setTimeout, preventing worker queue pile-up on slow devices or software WebGL.

import { state } from '../state.js';

export const EXPLICIT_SWEEP_INITIAL_DELAY_MS = 450;

export const EXPLICIT_SWEEP_STEPS = Object.freeze([
    // Initial hold at N = 0 (1 step)
    Object.freeze({ n: 0, intervalMs: EXPLICIT_SWEEP_INITIAL_DELAY_MS }),
    // Low N band: step by 1 (10 steps, 320 ms each -> 3.20 s)
    Object.freeze({ n: 1, intervalMs: 320 }),
    Object.freeze({ n: 2, intervalMs: 320 }),
    Object.freeze({ n: 3, intervalMs: 320 }),
    Object.freeze({ n: 4, intervalMs: 320 }),
    Object.freeze({ n: 5, intervalMs: 320 }),
    Object.freeze({ n: 6, intervalMs: 320 }),
    Object.freeze({ n: 7, intervalMs: 320 }),
    Object.freeze({ n: 8, intervalMs: 320 }),
    Object.freeze({ n: 9, intervalMs: 320 }),
    Object.freeze({ n: 10, intervalMs: 320 }),
    // Mid N band: step by 2..10 (15 steps, 220 ms each -> 3.30 s)
    Object.freeze({ n: 12, intervalMs: 220 }),
    Object.freeze({ n: 14, intervalMs: 220 }),
    Object.freeze({ n: 16, intervalMs: 220 }),
    Object.freeze({ n: 18, intervalMs: 220 }),
    Object.freeze({ n: 20, intervalMs: 220 }),
    Object.freeze({ n: 25, intervalMs: 220 }),
    Object.freeze({ n: 30, intervalMs: 220 }),
    Object.freeze({ n: 35, intervalMs: 220 }),
    Object.freeze({ n: 40, intervalMs: 220 }),
    Object.freeze({ n: 50, intervalMs: 220 }),
    Object.freeze({ n: 60, intervalMs: 220 }),
    Object.freeze({ n: 70, intervalMs: 220 }),
    Object.freeze({ n: 80, intervalMs: 220 }),
    Object.freeze({ n: 90, intervalMs: 220 }),
    Object.freeze({ n: 100, intervalMs: 220 }),
    // High N band: step by 20..80 (19 steps, 180 ms each -> 3.42 s)
    Object.freeze({ n: 120, intervalMs: 180 }),
    Object.freeze({ n: 140, intervalMs: 180 }),
    Object.freeze({ n: 160, intervalMs: 180 }),
    Object.freeze({ n: 180, intervalMs: 180 }),
    Object.freeze({ n: 200, intervalMs: 180 }),
    Object.freeze({ n: 240, intervalMs: 180 }),
    Object.freeze({ n: 280, intervalMs: 180 }),
    Object.freeze({ n: 320, intervalMs: 180 }),
    Object.freeze({ n: 360, intervalMs: 180 }),
    Object.freeze({ n: 400, intervalMs: 180 }),
    Object.freeze({ n: 450, intervalMs: 180 }),
    Object.freeze({ n: 500, intervalMs: 180 }),
    Object.freeze({ n: 560, intervalMs: 180 }),
    Object.freeze({ n: 620, intervalMs: 180 }),
    Object.freeze({ n: 700, intervalMs: 180 }),
    Object.freeze({ n: 780, intervalMs: 180 }),
    Object.freeze({ n: 860, intervalMs: 180 }),
    Object.freeze({ n: 930, intervalMs: 180 }),
    Object.freeze({ n: 1000, intervalMs: 180 }),
]);

const BUTTON_LABELS = {
    idle: '▶ N スイープ',
    running: '⏸ 停止',
    paused: '▶ 再開',
    done: '↺ もう一度再生',
};

let applyStepCallback = null;
let stopCallback = null;
let phaseCallback = null; // ('start' | 'complete' | 'abort') -> void; lets the explicit mode drive the view
let sweepToken = 0;
let timerId = null;

function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

function getIntervalScale() {
    const s = Number(state.explicitSweepIntervalScale);
    return Number.isFinite(s) && s >= 0 ? s : 1;
}

function clearSweepTimer() {
    if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
    }
}

export function syncExplicitSweepButton() {
    if (typeof document === 'undefined') return;
    const st = state.explicitSweepState || 'idle';
    const label = BUTTON_LABELS[st] || BUTTON_LABELS.idle;
    const isRunning = st === 'running';
    for (const id of ['explicit-sweep-btn', 'rh-guide-sweep-btn']) {
        const btn = document.getElementById(id);
        if (!btn) continue;
        btn.textContent = label;
        btn.classList.toggle('sweeping', isRunning);
    }
}

export function setExplicitSweepApplyCallback(fn) {
    applyStepCallback = typeof fn === 'function' ? fn : null;
}

export function setExplicitSweepStopCallback(fn) {
    stopCallback = typeof fn === 'function' ? fn : null;
}

export function setExplicitSweepPhaseCallback(fn) {
    phaseCallback = typeof fn === 'function' ? fn : null;
}

function notifyPhase(phase) {
    if (phaseCallback) phaseCallback(phase);
}

function setSweepState(nextState) {
    state.explicitSweepState = nextState;
    state.explicitSweeping = nextState === 'running';
    syncExplicitSweepButton();
    if (nextState === 'done') notifyPhase('complete');
}

export function stopExplicitSweep() {
    sweepToken++;
    clearSweepTimer();
    notifyPhase('abort');
    setSweepState('idle');
    if (stopCallback) stopCallback();
}

export function pauseExplicitSweep() {
    if (state.explicitSweepState !== 'running') return;
    sweepToken++;
    clearSweepTimer();
    notifyPhase('abort');
    setSweepState('paused');
}

function scheduleNextStep(stepIndex, myToken, delayMs) {
    clearSweepTimer();
    const waitMs = Math.max(0, Math.round(delayMs));
    timerId = setTimeout(() => {
        timerId = null;
        runStep(stepIndex, myToken);
    }, waitMs);
}

async function runStep(stepIndex, myToken) {
    if (myToken !== sweepToken || !state.explicitModeActive || state.explicitSweepState !== 'running') {
        return;
    }
    if (stepIndex >= EXPLICIT_SWEEP_STEPS.length) {
        setSweepState('done');
        return;
    }
    const step = EXPLICIT_SWEEP_STEPS[stepIndex];
    const t0 = nowMs();
    let ok = false;
    if (applyStepCallback) {
        try {
            ok = await applyStepCallback(step.n);
        } catch {
            ok = false;
        }
    }
    if (myToken !== sweepToken || !state.explicitModeActive || state.explicitSweepState !== 'running') {
        return;
    }
    if (!ok) {
        stopExplicitSweep();
        return;
    }
    if (stepIndex >= EXPLICIT_SWEEP_STEPS.length - 1) {
        setSweepState('done');
        return;
    }
    const elapsed = nowMs() - t0;
    const targetMs = step.intervalMs * getIntervalScale();
    scheduleNextStep(stepIndex + 1, myToken, Math.max(0, targetMs - elapsed));
}

// Arm the sweep state before an async fullRebuild() finishes N=0, returning a token
// so any user intervention or exit during fullRebuild() cancels the upcoming auto-sweep.
export function armExplicitSweep() {
    const myToken = ++sweepToken;
    clearSweepTimer();
    notifyPhase('start');
    setSweepState('running');
    return myToken;
}

// Continue an armed auto-sweep after N=0 has already been rendered by fullRebuild().
export function beginArmedExplicitSweep(myToken, initialDelayMs = EXPLICIT_SWEEP_INITIAL_DELAY_MS) {
    if (myToken !== sweepToken || !state.explicitModeActive || state.explicitSweepState !== 'running') {
        return;
    }
    const delayMs = initialDelayMs * getIntervalScale();
    scheduleNextStep(1, myToken, delayMs);
}

// Start a fresh sweep from N=0 -> 1000 (used by manual play / replay).
export function startExplicitSweep() {
    if (!state.explicitModeActive) return;
    const myToken = ++sweepToken;
    clearSweepTimer();
    notifyPhase('start');
    setSweepState('running');
    runStep(0, myToken);
}

// Resume a paused sweep from the next step strictly greater than the current N
// (or restart from N=0 if already at the final N).
export function resumeExplicitSweep() {
    if (!state.explicitModeActive) return;
    const curN = state.zetaZeroCount | 0;
    const nextIdx = EXPLICIT_SWEEP_STEPS.findIndex(s => s.n > curN);
    if (nextIdx < 0) {
        startExplicitSweep();
        return;
    }
    const myToken = ++sweepToken;
    clearSweepTimer();
    setSweepState('running');
    runStep(nextIdx, myToken);
}

export function toggleExplicitSweep() {
    if (!state.explicitModeActive) return;
    const st = state.explicitSweepState;
    if (st === 'running') {
        pauseExplicitSweep();
    } else if (st === 'paused') {
        resumeExplicitSweep();
    } else {
        startExplicitSweep();
    }
}

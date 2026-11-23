// Web Worker client integration

import { state } from './state.js';

let _worker = null;
let _workerReady = false;
let _zetaReqId = 0;
let _zetaActiveN = null;       // desired N of the latest in-flight zeta request
let _zetaResolveLast = null;   // resolver for the latest in-flight zeta request
let _zetaOnPartialLast = null; // callback for zeta_partial updates of the latest request
let _zetaShownN = null;        // zeros currently applied from zeta_partial for the active request
let _onZetaProgress = null;    // UI callback for stage:'zeta' progress updates
let _explicitReqId = 0;
const _explicitPending = new Map(); // reqId -> { resolve, reject }
const _failureListeners = [];

// Called (once per failure) after the worker died post-startup and its in-flight work was dropped.
export function onWorkerFailure(cb) {
    _failureListeners.push(cb);
}

export function setZetaProgressCallback(cb) {
    _onZetaProgress = cb;
}

function resetZetaProgress() {
    state.zetaComputing = false;
    state.zetaTargetN = 0;
    state.zetaProgressPct = 0;
    _zetaShownN = null;
    if (_onZetaProgress) {
        _onZetaProgress({ active: false, doneK: state.zetaComputedN, shownK: null, targetN: 0, pct: 0 });
    }
}

// A worker zeta message is applicable only if its generation matches the latest request AND
// the current mode/desired N still matches what was requested (prevents pre-rAF or out-of-band races).
function isCurrentZetaReply(m) {
    return m.reqId === _zetaReqId
        && _zetaActiveN !== null
        && state.zetaModeActive
        && !state.explicitModeActive
        && !state.padicModeActive
        && !state.primeDimModeActive
        && state.zetaZeroCount === _zetaActiveN;
}

const EXPLICIT_TIMEOUT_MS = 20000;   // no reply in this long => treat the worker as dead (no onerror needed)

function handleWorkerError(e, rejectInit) {
    const wasReady = _workerReady;
    _workerReady = false;
    rejectInit(e);                       // no-op once init has settled
    if (!wasReady) return;               // startup failure is handled by main.js's fallback
    const err = e instanceof Error ? e : new Error((e && e.message) || 'worker error');
    cancelPendingZetaRequests();
    for (const p of _explicitPending.values()) p.reject(err);
    _explicitPending.clear();
    for (const cb of _failureListeners) {
        try { cb(err); } catch (x) { console.error('worker failure listener threw', x); }
    }
}

export function isWorkerReady() {
    return _workerReady;
}

export function setWorkerReady(val) {
    _workerReady = val;
}

export function initWorker(onProgress) {
    return new Promise((resolve, reject) => {
        // Path relative to index.html
        _worker = new Worker('worker.js', { type: 'module' });
        _worker.onerror = (e) => handleWorkerError(e, reject);
        _worker.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'progress') {
                if (m.stage === 'zeta') {
                    // Drop stale progress from cancelled/superseded zeta requests or mismatched desired N.
                    if (isCurrentZetaReply(m)) {
                        state.zetaComputing = true;
                        state.zetaTargetN = m.targetN;
                        state.zetaProgressPct = m.pct;
                        if (_onZetaProgress) {
                            _onZetaProgress({
                                active: true,
                                doneK: m.doneK,
                                shownK: _zetaShownN,
                                startK: m.startK,
                                targetN: m.targetN,
                                pct: m.pct,
                            });
                        }
                    }
                } else if (onProgress) {
                    onProgress(m.stage, m.pct);
                }
            } else if (m.type === 'init_done') {
                // Adopt transferred buffers
                state.isPrimeArray = m.isPrime;
                state.primeGaps    = m.gaps;
                state.ntl_d        = m.ntl_d;
                state.ntl_sigma    = m.ntl_sigma;
                state.ntl_omega    = m.ntl_omega;
                state.ntl_mu       = m.ntl_mu;
                state.ntl_phi      = m.ntl_phi;
                _workerReady = true;
                resolve();
            } else if (m.type === 'explicit_done') {
                const res = _explicitPending.get(m.reqId);
                if (res) { _explicitPending.delete(m.reqId); res.resolve(m); }
            } else if (m.type === 'zeta_partial') {
                // Apply intermediate partial sum only for the latest request matching current desired N.
                if (isCurrentZetaReply(m)) {
                    state.zetaOffsets = m.offsets;       // normalized (visual)
                    state.zetaOffsetsRaw = m.rawOffsets; // unnormalized sum (kept consistent with offsets)
                    state.zetaComputedN = m.doneK;
                    _zetaShownN = m.doneK;
                    if (_zetaOnPartialLast) {
                        _zetaOnPartialLast(m);
                    }
                    if (_onZetaProgress) {
                        _onZetaProgress({
                            active: state.zetaComputing,
                            doneK: m.doneK,
                            shownK: _zetaShownN,
                            targetN: m.targetN,
                            pct: state.zetaProgressPct,
                        });
                    }
                }
            } else if (m.type === 'zeta_done') {
                // Apply only if it's the latest request and current desired N/mode still matches
                if (m.reqId === _zetaReqId) {
                    const apply = isCurrentZetaReply(m);
                    _zetaActiveN = null;
                    _zetaShownN = null;
                    _zetaOnPartialLast = null;
                    if (apply) {
                        state.zetaOffsets = m.offsets;       // normalized (visual)
                        state.zetaOffsetsRaw = m.rawOffsets; // unnormalized sum
                        const doneN = typeof m.N === 'number' ? m.N : state.zetaZeroCount;
                        state.zetaComputedN = doneN;
                        state.zetaComputing = false;
                        state.zetaTargetN = doneN;
                        state.zetaProgressPct = 0;
                        if (_onZetaProgress) {
                            _onZetaProgress({ active: false, doneK: doneN, shownK: doneN, targetN: doneN, pct: 0 });
                        }
                    } else {
                        resetZetaProgress();
                    }
                    if (_zetaResolveLast) {
                        _zetaResolveLast(apply);
                        _zetaResolveLast = null;
                    }
                }
            }
        };
        _worker.postMessage({ type: 'init', maxPoints: state.MAX_POINTS });
    });
}

export function cancelPendingZetaRequests({ notifyWorker = true } = {}) {
    _zetaReqId++;
    _zetaActiveN = null;
    const hadInFlight = _zetaResolveLast !== null;
    _zetaOnPartialLast = null;
    _zetaShownN = null;
    if (_zetaResolveLast) {
        _zetaResolveLast(false);
        _zetaResolveLast = null;
    }
    if (notifyWorker && hadInFlight && _worker && _workerReady) {
        _worker.postMessage({ type: 'zeta_cancel' });
    }
    resetZetaProgress();
}

// Request a zeta offset recompute. Returns a promise that resolves when the latest request lands.
// Older in-flight requests are abandoned (their reqId won't match).
export function requestZetaOffsets(N, amplitude, spacing, { onPartial = null } = {}) {
    // cancelPendingZetaRequests already bumps _zetaReqId, giving this request a
    // fresh id that supersedes any in-flight one. The incoming 'zeta' message
    // cancels any active worker job directly, so no separate 'zeta_cancel' is needed.
    cancelPendingZetaRequests({ notifyWorker: false });
    const id = _zetaReqId;
    _zetaActiveN = N;
    _zetaOnPartialLast = typeof onPartial === 'function' ? onPartial : null;
    return new Promise(resolve => {
        _zetaResolveLast = ok => resolve(ok === true);
        _worker.postMessage({
            type: 'zeta',
            reqId: id,
            N,
            amplitude,
            spacing
        });
    });
}

// Explicit-formula mode: post `msg` (type explicit_base | explicit_recon) and resolve with the worker reply.
// Resolves null when a newer request of any explicit kind superseded it (cancelExplicitRequests).
export function requestExplicit(msg) {
    const id = ++_explicitReqId;
    return new Promise((resolve, reject) => {
        if (!_workerReady) { reject(new Error('worker unavailable')); return; }
        const ms = state.explicitRequestTimeoutMs || EXPLICIT_TIMEOUT_MS;
        const timer = setTimeout(() => {
            if (!_explicitPending.has(id)) return;
            // Silent death (terminate() without an error event): same recovery as an error notification.
            const w = _worker;
            try { w && w.terminate(); } catch (x) { /* already gone */ }
            handleWorkerError(new Error('worker request timed out'), () => {});
        }, ms);
        _explicitPending.set(id, {
            resolve: v => { clearTimeout(timer); resolve(v); },
            reject: e => { clearTimeout(timer); reject(e); },
        });
        _worker.postMessage({ ...msg, reqId: id });
    });
}

export function cancelExplicitRequests() {
    for (const p of _explicitPending.values()) p.resolve(null);
    _explicitPending.clear();
}

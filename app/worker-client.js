// Web Worker client integration

import { state } from './state.js';

let _worker = null;
let _workerReady = false;
let _zetaReqId = 0;
let _zetaResolveLast = null; // resolver for the latest in-flight zeta request
let _explicitReqId = 0;
const _explicitPending = new Map(); // reqId -> { resolve, reject }
const _failureListeners = [];

// Called (once per failure) after the worker died post-startup and its in-flight work was dropped.
export function onWorkerFailure(cb) {
    _failureListeners.push(cb);
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
                if (onProgress) {
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
            } else if (m.type === 'zeta_done') {
                // Apply only if it's the latest request (drop stale results)
                if (m.reqId === _zetaReqId) {
                    state.zetaOffsets = m.offsets;       // normalized (visual)
                    state.zetaOffsetsRaw = m.rawOffsets; // unnormalized sum
                    if (_zetaResolveLast) {
                        _zetaResolveLast(true);
                        _zetaResolveLast = null;
                    }
                }
            }
        };
        _worker.postMessage({ type: 'init', maxPoints: state.MAX_POINTS });
    });
}

export function cancelPendingZetaRequests() {
    _zetaReqId++;
    if (_zetaResolveLast) {
        _zetaResolveLast(false);
        _zetaResolveLast = null;
    }
}

// Request a zeta offset recompute. Returns a promise that resolves when the latest request lands.
// Older in-flight requests are abandoned (their reqId won't match).
export function requestZetaOffsets(N, amplitude, spacing) {
    // cancelPendingZetaRequests already bumps _zetaReqId, giving this request a
    // fresh id that supersedes any in-flight one.
    cancelPendingZetaRequests();
    const id = _zetaReqId;
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

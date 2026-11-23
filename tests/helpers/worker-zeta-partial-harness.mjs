// Runs worker.js in plain Node with a stubbed `self` and controllable clock to verify PR 2 (zeta_partial):
//   - fast path (<= 20 zeros), cache hit, and N=0 emit zero zeta_partial messages
//   - chunked path emits first zeta_partial immediately after chunk 1, then throttled by >= 400ms (D3)
//   - every zeta_partial transfers both offsets and rawOffsets (distinct buffers) matching 0..doneK bit-for-bit
//   - final zeta_done matches single-pass accumulateZeroSumPsi bit-for-bit
//   - mutating transferred partial buffers does not corrupt _zetaCache (cache safety)
//   - zeta_cancel and superseding zeta requests (growing and shrinking N) drop stale partials cleanly
// Usage:
//   node worker-zeta-partial-harness.mjs <maxPoints>
//   node worker-zeta-partial-harness.mjs <maxPoints> --real-clock <startN> <endN>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance as nodePerformance } from 'node:perf_hooks';

const MAX = +process.argv[2] || 4001;
const REAL_CLOCK_MODE = process.argv[3] === '--real-clock';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ZETA_ZEROS_1000 } = await import(join(root, 'shared/zeta-zeros-1000.js'));
const { buildLnSqrtCaches, buildZetaDenom, accumulateZeroSumPsi, maxAbs, zetaNormScale, scaleInto } =
    await import(join(root, 'shared/explicit-formula.js'));

// Controllable monotonic clock (default mode): advance 150ms per completed chunk so chunk 1
// emits immediately and subsequent partials emit every 3 chunks (450ms >= 350ms).
// In --real-clock mode, keep Node's real high-resolution performance.now() to measure actual D3 intervals.
let fakeNow = 0;
if (!REAL_CLOCK_MODE) {
    Object.defineProperty(globalThis, 'performance', {
        value: { now: () => fakeNow },
        configurable: true,
        writable: true,
    });
}

let onPost = null;
globalThis.self = {
    postMessage: (m, transfer) => {
        if (onPost) onPost(m, transfer);
    },
};

await import(join(root, 'worker.js'));
self.onmessage({ data: { type: 'init', maxPoints: MAX } });

const { ln: refLn, sq: refSq } = buildLnSqrtCaches(MAX);
const refDenom = buildZetaDenom(ZETA_ZEROS_1000);

function referenceResult(N, amplitude, spacing) {
    const S = new Float64Array(MAX);
    accumulateZeroSumPsi(S, refLn, refSq, ZETA_ZEROS_1000, refDenom, 0, N);
    const raw = new Float32Array(MAX);
    for (let i = 0; i < MAX; i++) raw[i] = -2.0 * S[i];
    const offsets = new Float32Array(MAX);
    scaleInto(offsets, raw, zetaNormScale(maxAbs(raw), spacing, amplitude));
    return { raw, offsets };
}

function arraysBitEqual(a, b) {
    if (a.length !== b.length) return false;
    const va = new Uint32Array(a.buffer, a.byteOffset, a.length);
    const vb = new Uint32Array(b.buffer, b.byteOffset, b.length);
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
    return true;
}

const CHUNK_STEP_MS = 150;
const AMP = 1.5;
const SPACING = 4.0;

if (REAL_CLOCK_MODE) {
    const startN = +process.argv[4] || 100;
    const endN = +process.argv[5] || 300;
    const waitDone = (msg) => new Promise((resolve) => {
        const partialEvents = [];
        const tStart = nodePerformance.now();
        onPost = (m) => {
            if (m.type === 'zeta_partial' && m.reqId === msg.reqId) {
                partialEvents.push({ doneK: m.doneK, t: nodePerformance.now() - tStart });
            } else if (m.type === 'zeta_done' && m.reqId === msg.reqId) {
                const totalMs = nodePerformance.now() - tStart;
                onPost = null;
                resolve({ done: m, partialEvents, totalMs });
            }
        };
        self.onmessage({ data: msg });
    });

    if (startN > 0) {
        await waitDone({ type: 'zeta', reqId: 1, N: startN, amplitude: AMP, spacing: SPACING });
    }
    const run = await waitDone({ type: 'zeta', reqId: 2, N: endN, amplitude: AMP, spacing: SPACING });
    const refEnd = referenceResult(endN, AMP, SPACING);
    const intervalsMs = [];
    for (let i = 1; i < run.partialEvents.length; i++) {
        intervalsMs.push(+(run.partialEvents[i].t - run.partialEvents[i - 1].t).toFixed(2));
    }
    console.log(JSON.stringify({
        max: MAX,
        startN,
        endN,
        firstMs: run.partialEvents[0] ? +run.partialEvents[0].t.toFixed(2) : null,
        firstK: run.partialEvents[0] ? run.partialEvents[0].doneK : null,
        totalMs: +run.totalMs.toFixed(2),
        partialsCount: run.partialEvents.length,
        doneKs: run.partialEvents.map(p => p.doneK),
        intervalsMs,
        doneRawBitEqual: arraysBitEqual(run.done.rawOffsets, refEnd.raw),
        doneOffsetsBitEqual: arraysBitEqual(run.done.offsets, refEnd.offsets),
    }));
    process.exit(0);
}

function runRequest(msg, { advanceClock = true, poisonPartials = false } = {}) {
    return new Promise((resolve) => {
        const partials = [];
        onPost = (m, transfer) => {
            if (advanceClock && m.type === 'progress' && m.stage === 'zeta' && m.doneK > m.startK) {
                fakeNow += CHUNK_STEP_MS;
            } else if (m.type === 'zeta_partial') {
                const ref = referenceResult(m.doneK, msg.amplitude, msg.spacing);
                const transferOk = Array.isArray(transfer)
                    && transfer.length === 2
                    && transfer.includes(m.offsets.buffer)
                    && transfer.includes(m.rawOffsets.buffer);
                const entry = {
                    reqId: m.reqId,
                    doneK: m.doneK,
                    targetN: m.targetN,
                    t: fakeNow,
                    offsetsIsF32: m.offsets instanceof Float32Array,
                    rawIsF32: m.rawOffsets instanceof Float32Array,
                    distinctBuffers: m.offsets.buffer !== m.rawOffsets.buffer,
                    transferOk,
                    rawBitEqual: arraysBitEqual(m.rawOffsets, ref.raw),
                    offsetsBitEqual: arraysBitEqual(m.offsets, ref.offsets),
                };
                if (poisonPartials) {
                    // Simulate transferred buffer detachment / consumer mutation.
                    m.rawOffsets.fill(Number.NaN);
                    m.offsets.fill(Number.NaN);
                }
                partials.push(entry);
            } else if (m.type === 'zeta_done' && m.reqId === msg.reqId) {
                onPost = null;
                resolve({ done: m, partials });
            }
        };
        self.onmessage({ data: msg });
    });
}

const waitTicks = (ms = 60) => new Promise((r) => setTimeout(r, ms));

// 1. Fast path (0 -> 10), cache hit (10 -> 10), and N=0: zero partials
const fast = await runRequest({ type: 'zeta', reqId: 1, N: 10, amplitude: AMP, spacing: SPACING });
const hit = await runRequest({ type: 'zeta', reqId: 2, N: 10, amplitude: 2.0, spacing: SPACING });
const zero = await runRequest({ type: 'zeta', reqId: 3, N: 0, amplitude: AMP, spacing: SPACING });

// 2. Warm to N=100, then run N=100 -> 1000 with fakeNow stepping 150ms/chunk
await runRequest({ type: 'zeta', reqId: 4, N: 100, amplitude: AMP, spacing: SPACING });
fakeNow = 0;
const inc1000 = await runRequest(
    { type: 'zeta', reqId: 5, N: 1000, amplitude: AMP, spacing: SPACING },
    { advanceClock: true, poisonPartials: true }
);
const ref1000 = referenceResult(1000, AMP, SPACING);

// 3. Cancel right after a zeta_partial (poisoning its buffers), then verify cache hit + resume
await runRequest({ type: 'zeta', reqId: 6, N: 0, amplitude: AMP, spacing: SPACING });
fakeNow = 0;
let cancelAtK = null;
const strayAfterCancel = [];
await new Promise((resolve) => {
    let cancelled = false;
    onPost = (m) => {
        if (!cancelled) {
            if (m.type === 'progress' && m.stage === 'zeta' && m.reqId === 7 && m.doneK > m.startK) {
                fakeNow += CHUNK_STEP_MS;
            } else if (m.type === 'zeta_partial' && m.reqId === 7 && m.doneK >= 80) {
                cancelled = true;
                cancelAtK = m.doneK;
                m.rawOffsets.fill(Number.NaN);
                m.offsets.fill(Number.NaN);
                self.onmessage({ data: { type: 'zeta_cancel' } });
                resolve();
            }
        } else if (m.reqId === 7) {
            strayAfterCancel.push({ type: m.type, reqId: m.reqId, doneK: m.doneK });
        }
    };
    self.onmessage({ data: { type: 'zeta', reqId: 7, N: 1000, amplitude: AMP, spacing: SPACING } });
});
await waitTicks(80);
onPost = null;

const cancelCacheHit = await runRequest({ type: 'zeta', reqId: 8, N: cancelAtK, amplitude: AMP, spacing: SPACING });
const refCancelK = referenceResult(cancelAtK, AMP, SPACING);

fakeNow = 0;
const resume200 = await runRequest({ type: 'zeta', reqId: 9, N: 200, amplitude: AMP, spacing: SPACING });
const ref200 = referenceResult(200, AMP, SPACING);

// 4. Supersede mid-flight: shrinking N (0 -> 1000 superseded at partial >= 80 by N = 60)
await runRequest({ type: 'zeta', reqId: 10, N: 0, amplitude: AMP, spacing: SPACING });
fakeNow = 0;
const strayShrink = [];
const shrinkPartials = [];
const shrinkDone = await new Promise((resolve) => {
    let superseded = false;
    onPost = (m) => {
        if (!superseded) {
            if (m.type === 'progress' && m.stage === 'zeta' && m.reqId === 11 && m.doneK > m.startK) {
                fakeNow += CHUNK_STEP_MS;
            } else if (m.type === 'zeta_partial' && m.reqId === 11 && m.doneK >= 80) {
                superseded = true;
                fakeNow = 0;
                self.onmessage({ data: { type: 'zeta', reqId: 12, N: 60, amplitude: AMP, spacing: SPACING } });
            }
            return;
        }
        if (m.reqId === 11) {
            strayShrink.push({ type: m.type, reqId: m.reqId });
        } else if (m.reqId === 12 && m.type === 'progress' && m.stage === 'zeta' && m.doneK > m.startK) {
            fakeNow += CHUNK_STEP_MS;
        } else if (m.reqId === 12 && m.type === 'zeta_partial') {
            const ref = referenceResult(m.doneK, AMP, SPACING);
            shrinkPartials.push({
                reqId: m.reqId,
                doneK: m.doneK,
                targetN: m.targetN,
                rawBitEqual: arraysBitEqual(m.rawOffsets, ref.raw),
                offsetsBitEqual: arraysBitEqual(m.offsets, ref.offsets),
            });
        } else if (m.reqId === 12 && m.type === 'zeta_done') {
            onPost = null;
            resolve(m);
        }
    };
    self.onmessage({ data: { type: 'zeta', reqId: 11, N: 1000, amplitude: AMP, spacing: SPACING } });
});
const ref60 = referenceResult(60, AMP, SPACING);

// 5. Supersede mid-flight: growing N (0 -> 1000 superseded at partial >= 80 by N = 160)
await runRequest({ type: 'zeta', reqId: 13, N: 0, amplitude: AMP, spacing: SPACING });
fakeNow = 0;
let growSupersededAtK = null;
const strayGrow = [];
const growPartials = [];
const growDone = await new Promise((resolve) => {
    let superseded = false;
    onPost = (m) => {
        if (!superseded) {
            if (m.type === 'progress' && m.stage === 'zeta' && m.reqId === 14 && m.doneK > m.startK) {
                fakeNow += CHUNK_STEP_MS;
            } else if (m.type === 'zeta_partial' && m.reqId === 14 && m.doneK >= 80) {
                superseded = true;
                growSupersededAtK = m.doneK;
                fakeNow = 0;
                self.onmessage({ data: { type: 'zeta', reqId: 15, N: 160, amplitude: AMP, spacing: SPACING } });
            }
            return;
        }
        if (m.reqId === 14) {
            strayGrow.push({ type: m.type, reqId: m.reqId });
        } else if (m.reqId === 15 && m.type === 'progress' && m.stage === 'zeta' && m.doneK > m.startK) {
            fakeNow += CHUNK_STEP_MS;
        } else if (m.reqId === 15 && m.type === 'zeta_partial') {
            const ref = referenceResult(m.doneK, AMP, SPACING);
            growPartials.push({
                reqId: m.reqId,
                doneK: m.doneK,
                targetN: m.targetN,
                rawBitEqual: arraysBitEqual(m.rawOffsets, ref.raw),
                offsetsBitEqual: arraysBitEqual(m.offsets, ref.offsets),
            });
        } else if (m.reqId === 15 && m.type === 'zeta_done') {
            onPost = null;
            resolve(m);
        }
    };
    self.onmessage({ data: { type: 'zeta', reqId: 14, N: 1000, amplitude: AMP, spacing: SPACING } });
});
const ref160 = referenceResult(160, AMP, SPACING);

console.log(JSON.stringify({
    fastPartials: fast.partials.length,
    hitPartials: hit.partials.length,
    zeroPartials: zero.partials.length,
    inc1000: {
        partials: inc1000.partials,
        doneN: inc1000.done.N,
        doneRecomputed: inc1000.done.recomputed,
        doneRawBitEqual: arraysBitEqual(inc1000.done.rawOffsets, ref1000.raw),
        doneOffsetsBitEqual: arraysBitEqual(inc1000.done.offsets, ref1000.offsets),
    },
    cancel: {
        cancelAtK,
        strayAfterCancel,
        cacheHitRecomputed: cancelCacheHit.done.recomputed,
        cacheHitPartials: cancelCacheHit.partials.length,
        cacheHitRawBitEqual: arraysBitEqual(cancelCacheHit.done.rawOffsets, refCancelK.raw),
        cacheHitOffsetsBitEqual: arraysBitEqual(cancelCacheHit.done.offsets, refCancelK.offsets),
        resumePartials: resume200.partials,
        resumeDoneRawBitEqual: arraysBitEqual(resume200.done.rawOffsets, ref200.raw),
        resumeDoneOffsetsBitEqual: arraysBitEqual(resume200.done.offsets, ref200.offsets),
    },
    supersedeShrink: {
        strayShrink,
        partials: shrinkPartials,
        doneN: shrinkDone.N,
        doneRawBitEqual: arraysBitEqual(shrinkDone.rawOffsets, ref60.raw),
        doneOffsetsBitEqual: arraysBitEqual(shrinkDone.offsets, ref60.offsets),
    },
    supersedeGrow: {
        growSupersededAtK,
        strayGrow,
        partials: growPartials,
        doneN: growDone.N,
        doneRawBitEqual: arraysBitEqual(growDone.rawOffsets, ref160.raw),
        doneOffsetsBitEqual: arraysBitEqual(growDone.offsets, ref160.offsets),
    },
}));

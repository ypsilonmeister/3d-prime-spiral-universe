// Runs worker.js in plain Node with a stubbed `self` to test chunked async zeta execution:
//   - fast path (<= 20 zeros) and cache hit emit zero progress messages
//   - chunked path emits stage:'zeta' progress with reqId, startK, doneK, targetN, work-relative pct
//   - zeta_cancel stops in-flight chunks and preserves completed chunks in _zetaCache
//   - superseding zeta request drops old reqId and resumes from committed partial sum
//   - final offsets / rawOffsets match single-pass accumulateZeroSumPsi bit-for-bit
// Usage: node worker-zeta-chunked-harness.mjs <maxPoints>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MAX = +process.argv[2] || 4001;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { ZETA_ZEROS_1000 } = await import(join(root, 'shared/zeta-zeros-1000.js'));
const { buildLnSqrtCaches, buildZetaDenom, accumulateZeroSumPsi, maxAbs, zetaNormScale, scaleInto } =
    await import(join(root, 'shared/explicit-formula.js'));

const events = [];
let onPost = null;
globalThis.self = {
    postMessage: (m) => {
        events.push(m);
        if (onPost) onPost(m);
    },
};

await import(join(root, 'worker.js'));
self.onmessage({ data: { type: 'init', maxPoints: MAX } });

function referenceResult(N, amplitude, spacing) {
    const { ln, sq } = buildLnSqrtCaches(MAX);
    const denom = buildZetaDenom(ZETA_ZEROS_1000);
    const S = new Float64Array(MAX);
    accumulateZeroSumPsi(S, ln, sq, ZETA_ZEROS_1000, denom, 0, N);
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

function sendAndWaitDone(msg) {
    return new Promise((resolve) => {
        const progressMsgs = [];
        onPost = (m) => {
            if (m.type === 'progress' && m.stage === 'zeta') {
                progressMsgs.push({ reqId: m.reqId, pct: m.pct, doneK: m.doneK, startK: m.startK, targetN: m.targetN });
            } else if (m.type === 'zeta_done' && m.reqId === msg.reqId) {
                onPost = null;
                resolve({ done: m, progress: progressMsgs });
            }
        };
        self.onmessage({ data: msg });
    });
}

const waitTicks = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const AMP = 1.5;
const SPACING = 4.0;

// 1. Fast path (0 -> 10): no progress emitted
const fast = await sendAndWaitDone({ type: 'zeta', reqId: 1, N: 10, amplitude: AMP, spacing: SPACING });

// 2. Cache hit (10 -> 10, amplitude changed): no progress emitted, recomputed=false
const hit = await sendAndWaitDone({ type: 'zeta', reqId: 2, N: 10, amplitude: 2.0, spacing: SPACING });

// 3. Chunked incremental (10 -> 100): progress starts at startK=10, work-relative pct
const inc100 = await sendAndWaitDone({ type: 'zeta', reqId: 3, N: 100, amplitude: AMP, spacing: SPACING });
const ref100 = referenceResult(100, AMP, SPACING);

// 4. Chunked incremental (100 -> 1000): matches master single-pass bit-for-bit
const inc1000 = await sendAndWaitDone({ type: 'zeta', reqId: 4, N: 1000, amplitude: AMP, spacing: SPACING });
const ref1000 = referenceResult(1000, AMP, SPACING);

// 5. Reset to 0, then start 0 -> 1000 and cancel at doneK >= 60
await sendAndWaitDone({ type: 'zeta', reqId: 5, N: 0, amplitude: AMP, spacing: SPACING });

let cancelAtK = null;
const strayAfterCancel = [];
await new Promise((resolve) => {
    let cancelled = false;
    onPost = (m) => {
        if (!cancelled) {
            if (m.type === 'progress' && m.stage === 'zeta' && m.reqId === 6 && m.doneK >= 60) {
                cancelled = true;
                cancelAtK = m.doneK;
                self.onmessage({ data: { type: 'zeta_cancel' } });
                resolve();
            }
        } else if (m.reqId === 6) {
            strayAfterCancel.push({ type: m.type, reqId: m.reqId, doneK: m.doneK });
        }
    };
    self.onmessage({ data: { type: 'zeta', reqId: 6, N: 1000, amplitude: AMP, spacing: SPACING } });
});
await waitTicks(80);
onPost = null;

// 6. Request exact N = cancelAtK: must be cache hit (recomputed=false, 0 progress) and bit-exact
const resumeExact = await sendAndWaitDone({ type: 'zeta', reqId: 7, N: cancelAtK, amplitude: AMP, spacing: SPACING });
const refCancelK = referenceResult(cancelAtK, AMP, SPACING);

// 7. Resume from cancelAtK -> 200: startK === cancelAtK, bit-exact with clean 0..200
const resume200 = await sendAndWaitDone({ type: 'zeta', reqId: 8, N: 200, amplitude: AMP, spacing: SPACING });
const ref200 = referenceResult(200, AMP, SPACING);

// 8. Superseding mid-flight request: reset to 0, start 0 -> 1000 (reqId 9), at doneK >= 40 send N=120 (reqId 10)
await sendAndWaitDone({ type: 'zeta', reqId: 80, N: 0, amplitude: AMP, spacing: SPACING });
let supersededAtK = null;
const strayFromOld = [];
const supersededProgress = [];
const supersededDone = await new Promise((resolve) => {
    let sentNew = false;
    onPost = (m) => {
        if (!sentNew && m.type === 'progress' && m.stage === 'zeta' && m.reqId === 9 && m.doneK >= 40) {
            sentNew = true;
            supersededAtK = m.doneK;
            self.onmessage({ data: { type: 'zeta', reqId: 10, N: 120, amplitude: AMP, spacing: SPACING } });
            return;
        }
        if (sentNew) {
            if (m.reqId === 9) {
                strayFromOld.push({ type: m.type, reqId: m.reqId });
            } else if (m.reqId === 10 && m.type === 'progress' && m.stage === 'zeta') {
                supersededProgress.push({ reqId: m.reqId, startK: m.startK, doneK: m.doneK, targetN: m.targetN, pct: m.pct });
            } else if (m.reqId === 10 && m.type === 'zeta_done') {
                onPost = null;
                resolve(m);
            }
        }
    };
    self.onmessage({ data: { type: 'zeta', reqId: 9, N: 1000, amplitude: AMP, spacing: SPACING } });
});
const ref120 = referenceResult(120, AMP, SPACING);

console.log(JSON.stringify({
    fast: {
        progressCount: fast.progress.length,
        recomputed: fast.done.recomputed,
        N: fast.done.N,
    },
    hit: {
        progressCount: hit.progress.length,
        recomputed: hit.done.recomputed,
        N: hit.done.N,
    },
    inc100: {
        progress: inc100.progress,
        recomputed: inc100.done.recomputed,
        N: inc100.done.N,
        rawBitEqual: arraysBitEqual(inc100.done.rawOffsets, ref100.raw),
        offsetsBitEqual: arraysBitEqual(inc100.done.offsets, ref100.offsets),
    },
    inc1000: {
        progressCount: inc1000.progress.length,
        firstProgress: inc1000.progress[0],
        lastProgress: inc1000.progress[inc1000.progress.length - 1],
        recomputed: inc1000.done.recomputed,
        N: inc1000.done.N,
        rawBitEqual: arraysBitEqual(inc1000.done.rawOffsets, ref1000.raw),
        offsetsBitEqual: arraysBitEqual(inc1000.done.offsets, ref1000.offsets),
    },
    cancel: {
        cancelAtK,
        strayAfterCancel,
        resumeExactProgressCount: resumeExact.progress.length,
        resumeExactRecomputed: resumeExact.done.recomputed,
        resumeExactRawBitEqual: arraysBitEqual(resumeExact.done.rawOffsets, refCancelK.raw),
        resumeExactOffsetsBitEqual: arraysBitEqual(resumeExact.done.offsets, refCancelK.offsets),
        resume200FirstProgress: resume200.progress[0],
        resume200ProgressCount: resume200.progress.length,
        resume200RawBitEqual: arraysBitEqual(resume200.done.rawOffsets, ref200.raw),
        resume200OffsetsBitEqual: arraysBitEqual(resume200.done.offsets, ref200.offsets),
    },
    supersede: {
        supersededAtK,
        strayFromOld,
        firstProgress: supersededProgress[0],
        progressCount: supersededProgress.length,
        rawBitEqual: arraysBitEqual(supersededDone.rawOffsets, ref120.raw),
        offsetsBitEqual: arraysBitEqual(supersededDone.offsets, ref120.offsets),
    },
}));

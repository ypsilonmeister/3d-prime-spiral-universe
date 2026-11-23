// Runs worker.js in plain Node with a stubbed `self` and prints, as JSON, the
// zeta_done results needed by tests/worker-zeta-raw.spec.js.
//   node worker-zeta-harness.mjs <maxPoints> <amplitude> <spacing> <x,x,...> <N,N,...>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const [maxPoints, amplitude, spacing, xs, Ns] = process.argv.slice(2);
const sent = [];
let pendingDone = null;
globalThis.self = {
    postMessage: (m) => {
        sent.push(m);
        if (m.type === 'zeta_done' && pendingDone) {
            const resolve = pendingDone;
            pendingDone = null;
            resolve(m);
        }
    },
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await import(join(root, 'worker.js'));
self.onmessage({ data: { type: 'init', maxPoints: +maxPoints } });

function requestZeta(msg) {
    return new Promise((resolve) => {
        pendingDone = resolve;
        self.onmessage({ data: msg });
    });
}

const out = [];
for (const N of Ns.split(',').map(Number)) {
    const m = await requestZeta({ type: 'zeta', reqId: 7, N, amplitude: +amplitude, spacing: +spacing });
    let maxRaw = 0, maxNorm = 0, nonzero = 0;
    for (let i = 0; i < m.offsets.length; i++) {
        maxRaw = Math.max(maxRaw, Math.abs(m.rawOffsets[i]));
        maxNorm = Math.max(maxNorm, Math.abs(m.offsets[i]));
        if (m.offsets[i] !== 0 || m.rawOffsets[i] !== 0) nonzero++;
    }
    const at = (arr) => Object.fromEntries(xs.split(',').map(Number).map((x) => [x, arr[x - 1]])); // index i <-> x=i+1
    out.push({
        N, type: m.type, reqId: m.reqId,
        offsetsIsF32: m.offsets instanceof Float32Array, rawIsF32: m.rawOffsets instanceof Float32Array,
        len: m.offsets.length, rawLen: m.rawOffsets.length,
        distinctBuffers: m.offsets.buffer !== m.rawOffsets.buffer,
        maxRaw, maxNorm, nonzero,
        raw: at(m.rawOffsets), norm: at(m.offsets),
    });
}
console.log(JSON.stringify(out));

// Drives worker.js through a sequence of zeta requests and prints, as JSON, whether each one
// recomputed the zero sum. Usage: node worker-zeta-cache-harness.mjs <maxPoints>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
self.onmessage({ data: { type: 'init', maxPoints: +process.argv[2] } });

function requestZeta(msg) {
    return new Promise((resolve) => {
        pendingDone = resolve;
        self.onmessage({ data: msg });
    });
}

const seq = [
    [100, 1.0, 3.0], [100, 2.0, 3.0], [100, 2.0, 5.0], [100, 1.0, 3.0], // N fixed: only first computes
    [200, 1.0, 3.0], [100, 1.0, 3.0], [0, 1.0, 3.0], [100, 1.0, 3.0],  // N changes: each recomputes
];
const out = [];
for (const [N, amplitude, spacing] of seq) {
    const m = await requestZeta({ type: 'zeta', reqId: 1, N, amplitude, spacing });
    let maxRaw = 0, maxNorm = 0;
    for (let i = 0; i < m.offsets.length; i++) {
        maxRaw = Math.max(maxRaw, Math.abs(m.rawOffsets[i]));
        maxNorm = Math.max(maxNorm, Math.abs(m.offsets[i]));
    }
    out.push({ N, amplitude, spacing, recomputed: m.recomputed, maxRaw, maxNorm, raw500: m.rawOffsets[500], target: spacing * 8 * amplitude });
}
console.log(JSON.stringify(out));

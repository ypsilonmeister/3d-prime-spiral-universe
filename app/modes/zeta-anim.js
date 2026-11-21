// Zeta N-sweep animation ("Animate" button), shared by the UI binding and the explicit-formula mode
// (which pauses it on entry and resumes it on exit).

import { state } from '../state.js';
import { computeZetaOffsets, zetaEffectiveMaxN } from './zeta.js';

let target = 0;
let current = 0;   // the sweep's real tick position (state.zetaZeroCount can be moved by the slider)

function el(id) { return typeof document === 'undefined' ? null : document.getElementById(id); }

function setButton(text) {
    const b = el('zeta-anim-btn');
    if (b) b.textContent = text;
}

function showN(n) {
    const s = el('zeta-n-slider'), v = el('zeta-n-val');
    if (s) s.value = String(n);
    if (v) v.innerText = n;
}

export function zetaAnimTarget() { return target; }
export function zetaAnimN() { return current; }

export function stopZetaAnimation() {
    state.zetaAnimating = false;
    clearTimeout(state.zetaAnimFrame);
    setButton('Animate');
}

// Run the sweep from n (already applied by the caller or applied here when `apply`) up to `tgt`.
export function runZetaAnimation(n, tgt, { apply = true } = {}) {
    const cap = zetaEffectiveMaxN();
    target = tgt;
    if (n > cap) n = cap;
    current = n;
    clearTimeout(state.zetaAnimFrame);
    state.zetaZeroCount = n;
    showN(n);
    if (apply) computeZetaOffsets(n);
    if (n >= target || n >= cap) {
        stopZetaAnimation();
        return;
    }
    state.zetaAnimating = true;
    setButton('Stop');
    const step = () => {
        if (!state.zetaAnimating || n >= target || state.explicitModeActive) {
            stopZetaAnimation();
            return;
        }
        n++;
        current = n;
        state.zetaZeroCount = n;
        showN(n);
        computeZetaOffsets(n);
        // Stop on the tick that reaches target or the effective (fallback) cap.
        const stepCap = zetaEffectiveMaxN();
        if (state.zetaZeroCount < n) current = n = state.zetaZeroCount;
        if (n >= target || n >= stepCap) {
            stopZetaAnimation();
            return;
        }
        const delay = n < 10 ? 500 : n < 30 ? 300 : n < 60 ? 150 : 80;
        state.zetaAnimFrame = setTimeout(step, delay);
    };
    state.zetaAnimFrame = setTimeout(step, 300);
}

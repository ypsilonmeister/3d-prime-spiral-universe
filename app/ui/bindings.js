// UI event listeners, keyboard shortcuts, mobile gestures, and action bindings

import { state } from '../state.js';
import { getElement, updateUI, updateTypeUI, updateUIDisabledState } from './panels.js';
import { applyPositionOverlays } from '../render/lattice.js';
import { updateParticleVisuals, clearAboveActive } from '../render/particles.js';
import { toggleMode, onCountChange, isOverlayActive, rebuildPositions } from '../modes/mode-manager.js';
import { computeZetaOffsets } from '../modes/zeta.js';
import { computePadicValuations, applyPadicPositions, updatePadicColorVisuals } from '../modes/padic.js';
import { computePrimeDimValuations, applyPrimeDimPositions, buildPrimeDimAxisObjects, removePrimeDimAxisObjects, updatePrimeDimVisuals } from '../modes/prime-dim.js';
import { computeNTLOffsets, updateNTLVisuals } from '../modes/ntl.js';
import { sieveReset, sieveAdvanceStep, sieveUpdateStats } from '../modes/sieve-anim.js';

// --- Debounce / rAF-throttle helpers ---
function rafThrottle(fn) {
    let pending = false;
    let lastArgs = null;
    return (...args) => {
        lastArgs = args;
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            fn(...lastArgs);
        });
    };
}

export function bindUIEvents(enterVRCallback) {
    // 1. General controls
    const layoutSelect = getElement('layout-select');
    if (layoutSelect) {
        layoutSelect.addEventListener('change', (e) => {
            state.currentLayout = e.target.value;
            rebuildPositions();
            updateUI();
        });
    }

    const fillmodeSelect = getElement('fillmode-select');
    if (fillmodeSelect) {
        fillmodeSelect.addEventListener('change', (e) => {
            state.currentFillMode = e.target.value;
            rebuildPositions();
            updateUI();
        });
    }

    const colorSelect = getElement('color-select');
    if (colorSelect) {
        colorSelect.addEventListener('change', (e) => {
            state.colorMode = e.target.value;
            updateParticleVisuals();
            updateUI();
        });
    }

    const compositeSelect = getElement('composite-select');
    if (compositeSelect) {
        compositeSelect.addEventListener('change', (e) => {
            state.compositeMode = e.target.value;
            updateParticleVisuals();
            updateUI();
        });
    }

    const stereoSelect = getElement('stereo-select');
    if (stereoSelect) {
        stereoSelect.addEventListener('change', (e) => {
            state.stereoMode = e.target.value;
            // trigger resize logic (handled in entrypoint)
            window.dispatchEvent(new Event('resize'));
            updateUI();
        });
    }

    // Navigation buttons
    const navWarped = getElement('nav-warped');
    if (navWarped) {
        navWarped.addEventListener('click', () => {
            window.location.href = './warpednt/index.html';
        });
    }

    const navGaussian = getElement('nav-gaussian');
    if (navGaussian) {
        navGaussian.addEventListener('click', () => {
            window.location.href = './gaussianprimes/index.html';
        });
    }

    const navMusic = getElement('nav-music');
    if (navMusic) {
        navMusic.addEventListener('click', () => {
            window.location.href = './primemusic/index.html';
        });
    }

    const labelsToggle = getElement('sw-labels');
    if (labelsToggle) {
        labelsToggle.parentElement.addEventListener('click', () => {
            state.showLabels = !state.showLabels;
            if (state.points && state.points.material) {
                state.points.material.uniforms.uShowLabels.value = state.showLabels ? 1.0 : 0.0;
            }
            updateUI();
        });
    }

    const autogrowToggle = getElement('sw-autogrow');
    if (autogrowToggle) {
        autogrowToggle.parentElement.addEventListener('click', () => {
            state.autoGrow = !state.autoGrow;
            if (state.autoGrow) state.growSpeed = 50;
            updateUI();
        });
    }

    // 2. Zeta wave mode
    const groupZetaToggle = getElement('group-zeta-toggle');
    if (groupZetaToggle) {
        groupZetaToggle.querySelector('.toggle-row').addEventListener('click', () => {
            toggleMode('zeta');
            updateUI();
        });
    }

    const recomputeZeta = rafThrottle(() => {
        if (state.zetaModeActive) {
            computeZetaOffsets(state.zetaZeroCount);
        }
    });

    const zetaNSlider = getElement('zeta-n-slider');
    if (zetaNSlider) {
        zetaNSlider.addEventListener('input', (e) => {
            state.zetaZeroCount = parseInt(e.target.value);
            getElement('zeta-n-val').innerText = state.zetaZeroCount;
            recomputeZeta();
        });
    }

    const zetaAmpSlider = getElement('zeta-amp-slider');
    if (zetaAmpSlider) {
        zetaAmpSlider.addEventListener('input', (e) => {
            state.zetaAmplitude = parseFloat(e.target.value);
            getElement('zeta-amp-val').innerText = state.zetaAmplitude.toFixed(1);
            recomputeZeta();
        });
    }

    const zetaAnimBtn = getElement('zeta-anim-btn');
    if (zetaAnimBtn) {
        zetaAnimBtn.addEventListener('click', () => {
            if (state.zetaAnimating) {
                state.zetaAnimating = false;
                zetaAnimBtn.textContent = 'Animate';
                return;
            }
            state.zetaAnimating = true;
            zetaAnimBtn.textContent = 'Stop';
            if (!state.zetaModeActive) toggleMode('zeta');
            
            const target = state.zetaZeroCount > 0 ? state.zetaZeroCount : 100;
            state.zetaZeroCount = 0;
            zetaNSlider.value = 0;
            getElement('zeta-n-val').innerText = 0;
            computeZetaOffsets(0);
            
            let n = 0;
            const step = () => {
                if (!state.zetaAnimating || n >= target) {
                    state.zetaAnimating = false;
                    zetaAnimBtn.textContent = 'Animate';
                    return;
                }
                n++;
                state.zetaZeroCount = n;
                zetaNSlider.value = n;
                getElement('zeta-n-val').innerText = n;
                computeZetaOffsets(n);
                const delay = n < 10 ? 500 : n < 30 ? 300 : n < 60 ? 150 : 80;
                state.zetaAnimFrame = setTimeout(step, delay);
            };
            state.zetaAnimFrame = setTimeout(step, 300);
        });
    }

    // 3. p-adic mode
    const groupPadicToggle = getElement('group-padic-toggle');
    if (groupPadicToggle) {
        groupPadicToggle.querySelector('.toggle-row').addEventListener('click', () => {
            toggleMode('padic');
            updateUI();
        });
    }

    const padicPSelect = getElement('padic-p-select');
    if (padicPSelect) {
        padicPSelect.addEventListener('change', (e) => {
            state.padicP = parseInt(e.target.value);
            getElement('padic-p-val').innerText = state.padicP;
            if (state.padicModeActive) {
                computePadicValuations(state.padicP);
                applyPadicPositions();
                updatePadicColorVisuals();
            }
        });
    }

    const swPadicColor = getElement('sw-padic-color');
    if (swPadicColor) {
        swPadicColor.parentElement.addEventListener('click', () => {
            state.padicColorMode = !state.padicColorMode;
            updatePadicColorVisuals();
            updateUI();
        });
    }

    const padicAnimBtn = getElement('padic-anim-btn');
    if (padicAnimBtn) {
        padicAnimBtn.addEventListener('click', () => {
            if (state.padicAnimating) {
                state.padicAnimating = false;
                clearTimeout(state.padicAnimFrame);
                padicAnimBtn.textContent = 'Animate p';
                return;
            }
            state.padicAnimating = true;
            padicAnimBtn.textContent = 'Stop';
            if (!state.padicModeActive) toggleMode('padic');
            
            const PADIC_PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
            let idx = PADIC_PRIMES.indexOf(state.padicP);
            if (idx < 0) idx = 0;

            const step = () => {
                if (!state.padicAnimating) {
                    padicAnimBtn.textContent = 'Animate p';
                    return;
                }
                idx = (idx + 1) % PADIC_PRIMES.length;
                state.padicP = PADIC_PRIMES[idx];
                padicPSelect.value = state.padicP;
                getElement('padic-p-val').innerText = state.padicP;
                computePadicValuations(state.padicP);
                applyPadicPositions();
                updatePadicColorVisuals();
                state.padicAnimFrame = setTimeout(step, 1800);
            };
            state.padicAnimFrame = setTimeout(step, 300);
        });
    }

    // 4. Prime dimension mode
    const groupPrimedimToggle = getElement('group-primedim-toggle');
    if (groupPrimedimToggle) {
        groupPrimedimToggle.querySelector('.toggle-row').addEventListener('click', () => {
            toggleMode('prime-dim');
            updateUI();
        });
    }

    const primedimXSelect = getElement('primedim-x-select');
    if (primedimXSelect) {
        primedimXSelect.addEventListener('change', (e) => {
            state.primeDimP[0] = parseInt(e.target.value);
            if (state.primeDimModeActive) {
                computePrimeDimValuations();
                applyPrimeDimPositions();
                buildPrimeDimAxisObjects();
                updatePrimeDimVisuals();
            }
        });
    }
    const primedimYSelect = getElement('primedim-y-select');
    if (primedimYSelect) {
        primedimYSelect.addEventListener('change', (e) => {
            state.primeDimP[1] = parseInt(e.target.value);
            if (state.primeDimModeActive) {
                computePrimeDimValuations();
                applyPrimeDimPositions();
                buildPrimeDimAxisObjects();
                updatePrimeDimVisuals();
            }
        });
    }
    const primedimZSelect = getElement('primedim-z-select');
    if (primedimZSelect) {
        primedimZSelect.addEventListener('change', (e) => {
            state.primeDimP[2] = parseInt(e.target.value);
            if (state.primeDimModeActive) {
                computePrimeDimValuations();
                applyPrimeDimPositions();
                buildPrimeDimAxisObjects();
                updatePrimeDimVisuals();
            }
        });
    }

    const swPrimedimOnly = getElement('sw-primedim-only');
    if (swPrimedimOnly) {
        swPrimedimOnly.parentElement.addEventListener('click', () => {
            state.primeDimOnlyChosen = !state.primeDimOnlyChosen;
            if (state.primeDimModeActive) updatePrimeDimVisuals();
            updateUI();
        });
    }

    const randomTripleBtn = getElement('primedim-random-btn');
    if (randomTripleBtn) {
        randomTripleBtn.addEventListener('click', () => {
            const PADIC_PRIMES = [2,3,5,7,11,13,17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97];
            const pool = PADIC_PRIMES.slice();
            const chosen = [];
            while (chosen.length < 3) {
                const idx = Math.floor(Math.random() * pool.length);
                chosen.push(pool.splice(idx, 1)[0]);
            }
            chosen.sort((a, b) => a - b);
            state.primeDimP = chosen;
            primedimXSelect.value = chosen[0];
            primedimYSelect.value = chosen[1];
            primedimZSelect.value = chosen[2];
            if (state.primeDimModeActive) {
                computePrimeDimValuations();
                applyPrimeDimPositions();
                buildPrimeDimAxisObjects();
                updatePrimeDimVisuals();
            }
        });
    }

    // 5. NTL mode
    const swNtl = getElement('sw-ntl');
    if (swNtl) {
        swNtl.parentElement.addEventListener('click', () => {
            toggleMode('ntl');
            updateUI();
        });
    }

    const ntlFuncSelect = getElement('ntl-func-select');
    if (ntlFuncSelect) {
        ntlFuncSelect.addEventListener('change', (e) => {
            state.ntlFunc = e.target.value;
            if (state.ntlModeActive) {
                computeNTLOffsets();
                applyPositionOverlays();
                updateNTLVisuals();
            }
        });
    }

    const swNtlPerfect = getElement('sw-ntl-perfect');
    if (swNtlPerfect) {
        swNtlPerfect.parentElement.addEventListener('click', () => {
            state.ntlHighlightPerfect = !state.ntlHighlightPerfect;
            if (state.ntlModeActive) updateNTLVisuals();
            updateUI();
        });
    }

    const swNtlHc = getElement('sw-ntl-hc');
    if (swNtlHc) {
        swNtlHc.parentElement.addEventListener('click', () => {
            state.ntlHighlightHC = !state.ntlHighlightHC;
            if (state.ntlModeActive) updateNTLVisuals();
            updateUI();
        });
    }

    const recomputeNTL = rafThrottle(() => {
        if (state.ntlModeActive) {
            computeNTLOffsets();
            applyPositionOverlays();
        }
    });

    const ntlScaleSlider = getElement('ntl-scale-slider');
    if (ntlScaleSlider) {
        ntlScaleSlider.addEventListener('input', (e) => {
            state.ntlScale = parseFloat(e.target.value);
            getElement('ntl-scale-val').innerText = state.ntlScale.toFixed(1);
            recomputeNTL();
        });
    }

    // 6. Sieve animation mode
    const swSieve = getElement('sw-sieve');
    if (swSieve) {
        swSieve.parentElement.addEventListener('click', () => {
            toggleMode('sieve');
            updateUI();
        });
    }

    const sievePlayBtn = getElement('sieve-play-btn');
    if (sievePlayBtn) {
        sievePlayBtn.addEventListener('click', () => {
            if (!state.sieveModeActive) return;
            if (state.sieveFinished) sieveReset();
            else state.sievePlaying = !state.sievePlaying;
            
            sievePlayBtn.textContent = state.sievePlaying ? '⏸ Pause' : '▶ Play';
        });
    }

    const sieveStepBtn = getElement('sieve-step-btn');
    if (sieveStepBtn) {
        sieveStepBtn.addEventListener('click', () => {
            if (!state.sieveModeActive || state.sieveFinished) return;
            state.sievePlaying = false;
            sieveAdvanceStep();
            sieveUpdateStats();
            sievePlayBtn.textContent = '▶ Play';
        });
    }

    const sieveResetBtn = getElement('sieve-reset-btn');
    if (sieveResetBtn) {
        sieveResetBtn.addEventListener('click', () => {
            if (!state.sieveModeActive) return;
            state.sieveLimit = state.activePointCount;
            sieveReset();
            sievePlayBtn.textContent = '▶ Play';
        });
    }

    const sieveSpeedSlider = getElement('sieve-speed-slider');
    if (sieveSpeedSlider) {
        sieveSpeedSlider.addEventListener('input', (e) => {
            state.sieveSpeed = parseFloat(e.target.value);
            getElement('sieve-speed-val').innerText = state.sieveSpeed.toFixed(1) + 'x';
        });
    }

    // 7. Spacing, stride, point count sliders
    const recomputeLattice = rafThrottle(() => rebuildPositions());

    const spacingSlider = getElement('spacing-slider');
    if (spacingSlider) {
        spacingSlider.addEventListener('input', (e) => {
            state.currentSpacing = parseInt(e.target.value);
            getElement('spacing-val').innerText = state.currentSpacing;
            recomputeLattice();
        });
    }

    const strideSlider = getElement('stride-slider');
    if (strideSlider) {
        strideSlider.addEventListener('input', (e) => {
            state.linearStride = parseInt(e.target.value);
            getElement('stride-val').innerText = state.linearStride <= 0 ? 'Auto' : state.linearStride;
            recomputeLattice();
        });
    }

    const countSlider = getElement('count-slider');
    if (countSlider) {
        countSlider.addEventListener('input', (e) => {
            state.activePointCount = parseInt(e.target.value);
            state.autoGrow = false;
            getElement('count-val').innerText = state.activePointCount.toLocaleString();
            getElement('range-info').innerText = `1 - ${state.activePointCount.toLocaleString()}`;
            getElement('sw-autogrow').classList.toggle('on', state.autoGrow);
            onCountChange();
        });
    }

    // 8. General buttons
    const vrBtn = getElement('vr-btn');
    if (vrBtn) {
        vrBtn.addEventListener('click', () => {
            if (enterVRCallback) {
                enterVRCallback();
            }
        });
    }

    const centerBtn = getElement('center-btn');
    if (centerBtn) {
        centerBtn.addEventListener('click', () => centerOne());
    }

    const hideUIBtn = getElement('hide-ui-btn');
    if (hideUIBtn) {
        hideUIBtn.addEventListener('click', () => toggleUI());
    }

    // 9. Keyboard events
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h') toggleUI();
        if (e.key.toLowerCase() === 'c') centerOne();
        if (e.key.toLowerCase() === 'g') {
            state.autoGrow = !state.autoGrow;
            if (state.autoGrow) state.growSpeed = 50;
            updateUI();
        }
    });

    // 10. Mobile Gestures
    window.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 3) { toggleUI(); return; }
        if (e.touches.length > 1) return;
        const currentTime = new Date().getTime();
        if (currentTime - state.lastTapTime < 300) toggleUI();
        state.lastTapTime = currentTime;
    }, { passive: true });
}

export function toggleUI() {
    state.uiVisible = !state.uiVisible;
    getElement('ui-overlay').classList.toggle('hidden', !state.uiVisible);
    getElement('show-ui-hint').style.opacity = state.uiVisible ? '0' : '0.5';
}

export function centerOne() {
    if (!state.controls || !state.camera) return;
    const tx = state.targetPositions[0];
    const ty = state.targetPositions[1];
    const tz = state.targetPositions[2];
    state.controls.target.set(tx, ty, tz);
    state.camera.position.set(tx + 3000, ty + 3000, tz + 5000);
    state.controls.update();
}

export function toggleType(key) {
    state.typeVisibility[key] = !state.typeVisibility[key];
    updateParticleVisuals();
    updateTypeUI();
}

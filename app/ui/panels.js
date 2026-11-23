// UI Panel renders, DOM refs caching, help tooltips, and component state updates

import { state } from '../state.js';
import { NUMBER_TYPES } from '../render/particles.js';

let elements = {};

export function initElements() {
    const ids = [
        'boot-stage', 'boot-progress', 'boot-overlay', 'canvas-container',
        'layout-select', 'fillmode-select', 'color-select', 'type-panel', 'type-list',
        'sw-labels', 'sw-autogrow', 'stereo-select', 'stride-section', 'stride-val',
        'stride-slider', 'sw-zeta', 'zeta-controls', 'zeta-n-val', 'zeta-n-slider',
        'zeta-amp-val', 'zeta-amp-slider', 'zeta-anim-btn',
        'zeta-progress-wrap', 'zeta-progress', 'zeta-progress-text', 'sw-padic', 'padic-controls',
        'padic-p-val', 'padic-p-select', 'sw-padic-color', 'padic-anim-btn', 'sw-primedim',
        'primedim-controls', 'primedim-x-select', 'primedim-y-select', 'primedim-z-select',
        'sw-primedim-only', 'sw-ntl', 'ntl-controls', 'ntl-func-select', 'ntl-scale-val',
        'ntl-scale-slider', 'sw-ntl-perfect', 'sw-ntl-hc', 'sw-sieve', 'sieve-controls',
        'sieve-play-btn', 'sieve-speed-val', 'sieve-speed-slider', 'sieve-progress',
        'sieve-stats', 'composite-select', 'vr-btn', 'count-val', 'count-slider',
        'spacing-val', 'spacing-slider', 'range-info', 'current-state-text',
        'ui-overlay', 'show-ui-hint', 'help-tooltip', 'nav-rh', 'group-lattice', 'group-spacing',
        'group-zeta-toggle', 'group-explicit-toggle', 'sw-explicit', 'explicit-kind-psi1', 'explicit-kind-psi',
        'explicit-view-a', 'explicit-view-b', 'sw-explicit-primes', 'group-padic-toggle', 'group-primedim-toggle',
        'group-ntl-toggle', 'group-sieve-toggle'
    ];
    for (const id of ids) {
        elements[id] = document.getElementById(id);
    }
}

export function getElement(id) {
    return elements[id];
}

const BOOT_WORKER_STAGES = {
    primes:       ['Sieving primes',       0, 15],
    ntl_d_sigma:  ['Counting divisors',   15, 60],
    ntl_omega_mu: ['Factoring (ω, μ)',    60, 88],
    ntl_phi:      ['Computing totient φ', 88, 98],
};

export function setBootStage(text, pct) {
    const stage = elements['boot-stage'];
    const prog  = elements['boot-progress'];
    if (stage && text != null) stage.textContent = text;
    if (prog  && pct   != null) prog.value = pct;
}

export function onBootProgress(stage, pct) {
    const s = BOOT_WORKER_STAGES[stage];
    if (s) {
        const [label, lo, hi] = s;
        setBootStage(label, lo + (hi - lo) * (pct / 100));
    }
}

export function onSieveProgress(finished, foundCount, limit, currentP) {
    const el = elements['sieve-stats'];
    if (el) {
        if (finished) {
            el.textContent = `Done — ${foundCount} primes found`;
        } else {
            const sqrtN = Math.floor(Math.sqrt(limit));
            el.textContent = `Sieving ×${currentP} | Primes: ${foundCount} | √N=${sqrtN}`;
        }
    }
    const prog = elements['sieve-progress'];
    if (prog) {
        const sqrtN = Math.floor(Math.sqrt(limit));
        prog.value = Math.min(currentP / sqrtN, 1.0) * 100;
    }
}

export function onSieveUIUpdate() {
    const btn = elements['sieve-play-btn'];
    if (btn) btn.textContent = state.sievePlaying ? '⏸ Pause' : '▶ Play';
    onSieveProgress(state.sieveFinished, state.sieveFoundCount, state.sieveLimit, state.sieveCurrentP);
}

export function onZetaProgress({ active = false, doneK = 0, shownK = null, targetN = 0, pct = 0 } = {}) {
    const wrap = elements['zeta-progress-wrap'];
    const prog = elements['zeta-progress'];
    const text = elements['zeta-progress-text'];
    if (!wrap) return;
    const visible = Boolean(
        active
        && state.zetaModeActive
        && !state.explicitModeActive
        && !state.padicModeActive
        && !state.primeDimModeActive
        && !state.sieveModeActive
    );
    if (!visible) {
        if (wrap.style.display !== 'none') wrap.style.display = 'none';
        if (prog && prog.value !== 0) prog.value = 0;
        if (text && text.textContent !== '') text.textContent = '';
        return;
    }
    const clampedPct = Math.max(0, Math.min(100, pct));
    wrap.style.display = '';
    if (prog) prog.value = clampedPct;
    if (text) {
        if (typeof shownK === 'number') {
            text.textContent = `Showing ${shownK} / ${targetN} zeros… (${Math.round(clampedPct)}%)`;
        } else {
            text.textContent = `Computing zeros… ${doneK} / ${targetN} (${Math.round(clampedPct)}%)`;
        }
    }
}

export function hideBootOverlay() {
    const ov = elements['boot-overlay'];
    if (!ov) return;
    ov.classList.add('hidden');
    setTimeout(() => { ov.style.display = 'none'; }, 700);
}

export function buildTypeUI(toggleTypeCallback) {
    const container = elements['type-list'];
    if (!container) return;
    container.innerHTML = '';
    for (const t of NUMBER_TYPES) {
        const row = document.createElement('div');
        row.className = 'type-row';
        row.id = `type-row-${t.key}`;
        row.innerHTML = `
            <span class="type-dot" style="background:${t.color};box-shadow:0 0 5px ${t.color}"></span>
            <span class="type-label">${t.label}</span>
            <div class="toggle-switch ${t.defaultOn ? 'on' : ''}" id="sw-type-${t.key}"></div>
        `;
        row.addEventListener('click', () => toggleTypeCallback(t.key));
        container.appendChild(row);
    }
}

export function updateTypeUI() {
    for (const t of NUMBER_TYPES) {
        const sw = document.getElementById(`sw-type-${t.key}`);
        if (sw) sw.classList.toggle('on', !!state.typeVisibility[t.key]);
    }
}

export function setGroupDisabled(id, disabled) {
    const el = elements[id];
    if (!el) return;
    el.classList.toggle('ui-section-disabled', disabled);
}

export function updateUIDisabledState() {
    const padic = state.padicModeActive;
    const pdim  = state.primeDimModeActive;
    const explicit = state.explicitModeActive;
    const sieve = state.sieveModeActive;
    const exclusivePos = padic || pdim;
    setGroupDisabled('group-lattice',         exclusivePos || explicit || sieve);
    setGroupDisabled('group-spacing',         exclusivePos || explicit || sieve);
    setGroupDisabled('group-zeta-toggle',     exclusivePos || explicit || sieve);
    setGroupDisabled('group-explicit-toggle', exclusivePos || sieve);
    setGroupDisabled('zeta-controls',         exclusivePos || sieve);
    setGroupDisabled('group-padic-toggle',    pdim || explicit || sieve);
    setGroupDisabled('padic-controls',        pdim || explicit || sieve);
    setGroupDisabled('group-primedim-toggle', padic || explicit || sieve);
    setGroupDisabled('primedim-controls',     padic || explicit || sieve);
    setGroupDisabled('group-ntl-toggle',      sieve);
    setGroupDisabled('ntl-controls',          sieve);
    setGroupDisabled('group-sieve-toggle',    exclusivePos || explicit);
    setGroupDisabled('sieve-controls',        exclusivePos || explicit);
}

export function updateUI() {
    if (elements['layout-select']) elements['layout-select'].value = state.currentLayout;
    if (elements['fillmode-select']) elements['fillmode-select'].value = state.currentFillMode;
    if (elements['count-val']) elements['count-val'].innerText = state.activePointCount.toLocaleString();
    if (elements['count-slider']) elements['count-slider'].value = state.activePointCount;
    if (elements['range-info']) elements['range-info'].innerText = `1 - ${state.activePointCount.toLocaleString()}`;
    
    const st = elements['current-state-text'];
    if (st) st.innerText = `${state.currentLayout.toUpperCase()} - ${state.currentFillMode.toUpperCase()}`;
    
    const compSelect = elements['composite-select'];
    if (compSelect) compSelect.value = state.compositeMode;

    if (elements['sw-labels']) elements['sw-labels'].classList.toggle('on', state.showLabels);
    if (elements['sw-autogrow']) elements['sw-autogrow'].classList.toggle('on', state.autoGrow);
    if (elements['color-select']) elements['color-select'].value = state.colorMode;
    if (elements['stereo-select']) elements['stereo-select'].value = state.stereoMode;
    
    const strideSection = elements['stride-section'];
    if (strideSection) strideSection.style.display = (state.currentFillMode === 'linear') ? '' : 'none';
    if (elements['stride-val']) elements['stride-val'].innerText = state.linearStride <= 0 ? 'Auto' : state.linearStride;
    if (elements['stride-slider']) elements['stride-slider'].value = state.linearStride;

    const typePanel = elements['type-panel'];
    if (typePanel) typePanel.style.display = (state.colorMode === 'types') ? '' : 'none';

    if (elements['sw-zeta']) elements['sw-zeta'].classList.toggle('on', state.zetaModeActive);
    if (elements['zeta-controls']) elements['zeta-controls'].style.display = (state.zetaModeActive || state.explicitModeActive) ? '' : 'none';
    // Amplitude / Animate only apply to the zeta wave overlay; explicit mode shares just the N slider.
    const waveOnly = document.getElementById('zeta-wave-only');
    if (waveOnly) waveOnly.style.display = state.zetaModeActive ? '' : 'none';
    const zetaProgressWrap = elements['zeta-progress-wrap'];
    if (zetaProgressWrap && (
        !state.zetaComputing
        || !state.zetaModeActive
        || state.explicitModeActive
        || state.padicModeActive
        || state.primeDimModeActive
        || state.sieveModeActive
    )) {
        zetaProgressWrap.style.display = 'none';
    }
    if (elements['sw-explicit']) elements['sw-explicit'].classList.toggle('on', state.explicitModeActive);
    const expCtl = document.getElementById('explicit-controls');
    if (expCtl) expCtl.style.display = state.explicitModeActive ? '' : 'none';

    if (elements['sw-padic']) elements['sw-padic'].classList.toggle('on', state.padicModeActive);
    if (elements['padic-controls']) elements['padic-controls'].style.display = state.padicModeActive ? '' : 'none';

    if (elements['sw-primedim']) elements['sw-primedim'].classList.toggle('on', state.primeDimModeActive);
    if (elements['primedim-controls']) elements['primedim-controls'].style.display = state.primeDimModeActive ? '' : 'none';

    if (elements['sw-ntl']) elements['sw-ntl'].classList.toggle('on', state.ntlModeActive);
    if (elements['ntl-controls']) elements['ntl-controls'].style.display = state.ntlModeActive ? '' : 'none';

    if (elements['sw-sieve']) elements['sw-sieve'].classList.toggle('on', state.sieveModeActive);
    if (elements['sieve-controls']) elements['sieve-controls'].style.display = state.sieveModeActive ? '' : 'none';

    updateTypeUI();
    updateUIDisabledState();
}

export function setupHelpTooltips() {
    const tooltip = elements['help-tooltip'];
    if (!tooltip) return;
    const MARGIN = 8;
    const GAP = 10;
    let activeTip = null;

    const place = (anchor) => {
        const text = anchor.getAttribute('data-tip');
        if (!text) return;
        tooltip.textContent = text;
        tooltip.classList.add('visible');
        tooltip.setAttribute('aria-hidden', 'false');

        const rect = anchor.getBoundingClientRect();
        const tw = tooltip.offsetWidth;
        const th = tooltip.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = rect.right + GAP;
        if (left + tw + MARGIN > vw) left = rect.left - GAP - tw;
        left = Math.max(MARGIN, Math.min(left, vw - tw - MARGIN));

        let top = rect.top + rect.height / 2 - th / 2;
        top = Math.max(MARGIN, Math.min(top, vh - th - MARGIN));

        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
    };

    const hide = () => {
        tooltip.classList.remove('visible');
        tooltip.setAttribute('aria-hidden', 'true');
        activeTip = null;
    };

    document.querySelectorAll('.help-tip').forEach(el => {
        el.setAttribute('tabindex', '0');
        el.addEventListener('mouseenter', () => { activeTip = el; place(el); });
        el.addEventListener('mouseleave', () => { if (activeTip === el) hide(); });
        el.addEventListener('focus', () => { activeTip = el; place(el); });
        el.addEventListener('blur', () => { if (activeTip === el) hide(); });
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeTip === el) hide();
            else { activeTip = el; place(el); }
        });
    });

    document.addEventListener('click', (e) => {
        if (activeTip && !activeTip.contains(e.target)) hide();
    });
    window.addEventListener('scroll', () => { if (activeTip) place(activeTip); }, true);
    window.addEventListener('resize', () => { if (activeTip) place(activeTip); });
}

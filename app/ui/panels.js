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
        'zeta-amp-val', 'zeta-amp-slider', 'zeta-anim-btn', 'sw-padic', 'padic-controls',
        'padic-p-val', 'padic-p-select', 'sw-padic-color', 'padic-anim-btn', 'sw-primedim',
        'primedim-controls', 'primedim-x-select', 'primedim-y-select', 'primedim-z-select',
        'sw-primedim-only', 'sw-ntl', 'ntl-controls', 'ntl-func-select', 'ntl-scale-val',
        'ntl-scale-slider', 'sw-ntl-perfect', 'sw-ntl-hc', 'sw-sieve', 'sieve-controls',
        'sieve-play-btn', 'sieve-speed-val', 'sieve-speed-slider', 'sieve-progress',
        'sieve-stats', 'composite-select', 'vr-btn', 'count-val', 'count-slider',
        'spacing-val', 'spacing-slider', 'range-info', 'current-state-text',
        'ui-overlay', 'show-ui-hint', 'help-tooltip', 'group-lattice', 'group-spacing',
        'group-zeta-toggle', 'group-padic-toggle', 'group-primedim-toggle'
    ];
    for (const id of ids) {
        elements[id] = document.getElementById(id);
    }
}

export function getElement(id) {
    return elements[id];
}

export function setBootStage(text, pct) {
    const stage = elements['boot-stage'];
    const prog  = elements['boot-progress'];
    if (stage && text != null) stage.textContent = text;
    if (prog  && pct   != null) prog.value = pct;
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
    const exclusivePos = padic || pdim;
    setGroupDisabled('group-lattice',        exclusivePos);
    setGroupDisabled('group-spacing',        exclusivePos);
    setGroupDisabled('group-zeta-toggle',    exclusivePos);
    setGroupDisabled('zeta-controls',        exclusivePos);
    setGroupDisabled('group-padic-toggle',   pdim);
    setGroupDisabled('padic-controls',       pdim);
    setGroupDisabled('group-primedim-toggle', padic);
    setGroupDisabled('primedim-controls',    padic);
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
    if (elements['zeta-controls']) elements['zeta-controls'].style.display = state.zetaModeActive ? '' : 'none';

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

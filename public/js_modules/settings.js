/**
 * Settings Module
 * Handles settings UI and configuration
 */

import { getState, getNow, saveState, clone, DEFAULT_STATE, DEFAULT_LABELS } from './state.js';
import { calculateSchedule } from './scheduler.js';
import { applyAppearance, normOrder, BLOCKS, FIXED, THEMES } from './ui.js';
import { playBeep, unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');

// [input id, settings key, min, max, integer?]
const NUMBERS = [
    ['set-doses', 'totalDoses', 1, 24, true],
    ['set-interval', 'standardInterval', 0.25, 24],
    ['set-min-interval', 'minInterval', 0.25, 24],
    ['set-step', 'step', 0.25, 12],
    ['set-min-doses', 'minDoses', 1, 24, true],
    ['set-snooze-count', 'snoozeCount', 0, 20, true],
    ['set-snooze-mins', 'snoozeMinutes', 1, 240, true],
    ['set-eat-before', 'eatBeforeMin', 0, 600, true],
    ['set-eat-after', 'eatAfterMin', 0, 600, true],
    ['set-beep-interval-1', 'beepInterval1', 1, 60, true],
    ['set-beep-interval-2', 'beepInterval2', 1, 600, true],
    ['set-idle-reset', 'idleResetHours', 0, 48, true],
];
const CHECKS = [
    ['set-use-endtime', 'useEndTime'],
    ['set-allow-dose-reduction', 'allowDoseReduction'],
    ['set-auto-reset-enabled', 'autoResetEnabled'],
];
const LABEL_NAMES = {
    eatYes: 'Eating allowed', eatNo: 'Eating not allowed', eatIdle: 'Before first pill',
    eatTime: 'Eat time card', doseTime: 'Dose time card', takeFirst: 'First pill button',
    take: 'Pill due button', resetDay: 'Reset day button', allDone: 'All done button',
};

let draft = null; // appearance being edited (previewed live, reverted on close)

function renderAppearance() {
    $('theme-picker').innerHTML = Object.entries(THEMES).map(([id, [name, bg, fg]]) =>
        `<button type="button" class="swatch" data-theme-id="${id}" aria-pressed="${draft.theme === id}"
            style="background:${bg};color:${fg};border-color:${fg}">${name}</button>`).join('');

    const hidden = new Set(draft.hidden);
    for (const group of ['info', 'action', 'tool']) {
        const order = normOrder(draft[group + 'Order'], group);
        $('order-' + group).innerHTML = order.map((id, i) => `
            <li>
                <input type="checkbox" data-show="${id}" ${hidden.has(id) ? '' : 'checked'} ${FIXED.includes(id) ? 'disabled' : ''} aria-label="Show ${BLOCKS[group][id]}">
                <span>${BLOCKS[group][id]}</span>
                <button type="button" data-move="${group}:${i}:-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up"><i class="fa-solid fa-arrow-up"></i></button>
                <button type="button" data-move="${group}:${i}:1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Move down"><i class="fa-solid fa-arrow-down"></i></button>
            </li>`).join('');
    }
    applyAppearance(draft);
}

function onSheetClick(e) {
    const t = e.target.closest('button, input');
    if (!t || !draft) return;
    if (t.dataset.themeId) {
        draft.theme = t.dataset.themeId;
    } else if (t.dataset.move) {
        const [group, i, dir] = t.dataset.move.split(':');
        const order = normOrder(draft[group + 'Order'], group);
        const j = +i + +dir;
        [order[i], order[j]] = [order[j], order[i]];
        draft[group + 'Order'] = order;
    } else if (t.dataset.show) {
        const id = t.dataset.show;
        draft.hidden = t.checked ? draft.hidden.filter(h => h !== id) : [...draft.hidden, id];
    } else return;
    renderAppearance();
}

function onSheetInput(e) {
    if (!draft) return;
    const id = e.target.id;
    if (id === 'set-font-scale') draft.fontScale = +e.target.value;
    else if (id === 'set-swap') draft.swapSides = e.target.checked;
    else if (id === 'set-clock24') draft.clock24 = e.target.checked;
    else if (id === 'set-keep-awake') draft.keepAwake = e.target.checked;
    else return;
    applyAppearance(draft);
}

let wired = false;
export function toggleSettings() {
    const state = getState();
    const s = state.settings;
    const el = $('settings-overlay');
    el.hidden = !el.hidden;

    if (el.hidden) {
        // Closed: drop unsaved appearance preview
        draft = null;
        applyAppearance(s.ui);
        return;
    }
    if (!wired) {
        el.addEventListener('click', onSheetClick);
        el.addEventListener('input', onSheetInput);
        wired = true;
    }

    draft = clone(s.ui);
    draft.hidden = draft.hidden || [];
    $('set-interval-mode').value = s.intervalMode || 'fixed';
    for (const [id, key] of NUMBERS) $(id).value = s[key];
    for (const [id, key] of CHECKS) $(id).checked = !!s[key];
    $('set-endtime').value = `${pad(s.endHour)}:${pad(s.endMinute || 0)}`;
    $('set-reset-hour').value = `${pad(s.autoResetHour || 0)}:${pad(s.autoResetMinute || 0)}`;
    $('set-beep-volume').value = s.beepVolume ?? 0.25;
    $('set-font-scale').value = draft.fontScale;
    $('set-clock24').checked = !!draft.clock24;
    $('set-swap').checked = !!draft.swapSides;
    $('set-keep-awake').checked = draft.keepAwake !== false;
    $('label-fields').innerHTML = Object.entries(LABEL_NAMES).map(([k, name]) =>
        `<label class="stack">${name}<input type="text" maxlength="40" data-label="${k}" placeholder="${DEFAULT_LABELS[k]}"></label>`).join('');
    document.querySelectorAll('[data-label]').forEach(inp => { 
        const v = draft.labels?.[inp.dataset.label];
        inp.value = v && v !== DEFAULT_LABELS[inp.dataset.label] ? v : '';
    });

    renderAppearance();
    updateSettingsVisibility();
}

export function resetAppearance() {
    if (!draft) return;
    draft = clone(DEFAULT_STATE.settings.ui);
    document.querySelectorAll('[data-label]').forEach(inp => { inp.value = ''; });
    $('set-font-scale').value = draft.fontScale;
    $('set-clock24').checked = draft.clock24;
    $('set-swap').checked = draft.swapSides;
    $('set-keep-awake').checked = draft.keepAwake;
    renderAppearance();
}

function parseTime(id) {
    const [h, m] = ($(id).value || '').split(':').map(Number);
    return Number.isInteger(h) && Number.isInteger(m) ? [h, m] : null;
}

/** @returns {boolean} true if saved */
export function saveSettings() {
    const state = getState();
    const s = state.settings;

    // Validate everything first; save nothing if any field is bad
    const vals = {};
    for (const [id, key, min, max, int] of NUMBERS) {
        const v = Number($(id).value);
        if ($(id).value === '' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) {
            $(id).focus();
            alertBad(`"${$(id).closest('label').firstChild.textContent.trim()}" must be ${int ? 'a whole number' : 'a number'} from ${min} to ${max}.`);
            return false;
        }
        vals[key] = v;
    }
    if (vals.minInterval > vals.standardInterval) return alertBad('Minimum interval cannot be more than the standard interval.');
    if (vals.minDoses > vals.totalDoses) vals.minDoses = vals.totalDoses;
    const end = parseTime('set-endtime');
    const reset = parseTime('set-reset-hour');
    if ($('set-use-endtime').checked && !end) return alertBad('Enter a target end time.');
    if ($('set-auto-reset-enabled').checked && !reset) return alertBad('Enter a reset time.');

    // A new reset time (or idle limit) can put today's doses in "yesterday": warn first
    const d0 = state.data;
    if (d0.firstDoseTime) {
        const now = getNow();
        let wipes = false;
        if ($('set-auto-reset-enabled').checked) {
            const start = new Date(now);
            start.setHours(reset[0], reset[1], 0, 0);
            if (start > now) start.setDate(start.getDate() - 1);
            wipes = d0.firstDoseTime < start.getTime();
        }
        const idleMs = vals.idleResetHours * 3600e3;
        if (idleMs > 0 && now - Math.max(d0.lastDoseTime || 0, d0.nextDoseScheduled || 0) > idleMs) wipes = true;
        if (wipes && !window.confirm("With these reset settings, today's doses will be cleared right away. Continue?")) return false;
    }

    Object.assign(s, vals);
    s.intervalMode = $('set-interval-mode').value;
    for (const [id, key] of CHECKS) s[key] = $(id).checked;
    if (end) [s.endHour, s.endMinute] = end;
    if (reset) [s.autoResetHour, s.autoResetMinute] = reset;
    s.beepVolume = Number($('set-beep-volume').value);

    const labels = {};
    document.querySelectorAll('[data-label]').forEach(inp => { if (inp.value.trim()) labels[inp.dataset.label] = inp.value.trim(); });
    s.ui = { ...draft, labels };

    // Recalculate in the middle of a day (also caps snoozes to the new limit)
    const d = state.data;
    d.snoozesUsedForCurrent = Math.min(d.snoozesUsedForCurrent, s.snoozeCount);
    d.effectiveTotalDoses = s.totalDoses;
    if (d.dosesTaken > s.totalDoses) d.dosesTaken = s.totalDoses;
    calculateSchedule();

    saveState();
    toggleSettings(); // closes and applies saved appearance
    return true;
}

function alertBad(msg) {
    window.alert(msg);
    return false;
}

export function updateSettingsVisibility() {
    const adaptive = $('set-interval-mode').value === 'adaptive';
    $('adaptive-settings-section').hidden = !adaptive;
    $('set-endtime').disabled = !$('set-use-endtime').checked;
    $('min-doses-row').hidden = !(adaptive && $('set-allow-dose-reduction').checked);
    $('set-reset-hour').disabled = !$('set-auto-reset-enabled').checked;
}

export function testBeep() {
    unlockAudio();
    const prev = getState().settings.beepVolume;
    getState().settings.beepVolume = Number($('set-beep-volume').value); // preview unsaved volume
    setTimeout(() => { playBeep(600); getState().settings.beepVolume = prev; }, 50);
}

/**
 * Change the clock correction. Logged dose times shift with it, so fixing a
 * wrong tablet clock never makes a pill due early or late.
 */
function setOffset(offset) {
    const d = getState().data;
    const delta = offset - (d.timeOffset || 0);
    for (const k of ['lastDoseTime', 'firstDoseTime', 'nextDoseScheduled']) if (d[k]) d[k] += delta;
    for (const h of getState().history) {
        for (const k of ['lastDoseTime', 'firstDoseTime', 'nextDoseScheduled']) if (h[k]) h[k] += delta;
    }
    d.timeOffset = offset;
    saveState();
}

export function applyTimeOffset() {
    const t = parseTime('set-time-input');
    if (!t) return;
    const nowReal = Date.now();
    const desired = new Date(nowReal);
    desired.setHours(t[0], t[1], 0, 0);
    // Pick the nearest day: 23:50 -> 00:10 is +20 min, not -23h40m
    const DAY = 24 * 3600e3;
    let off = desired.getTime() - nowReal;
    if (off > DAY / 2) off -= DAY;
    else if (off < -DAY / 2) off += DAY;
    setOffset(off);
}

export function clearTimeOffset() {
    setOffset(0);
}

export function hardReset() {
    if (confirm('Erase all settings and data completely?')) {
        localStorage.removeItem('pillTrackerState');
        location.reload();
    }
}
